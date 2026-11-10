import { invoke } from '@tauri-apps/api/core'
import { listen } from '@tauri-apps/api/event'

export interface StreamHandlers {
  onItems(items: any[], nextPageToken?: string): void
  onEnd(error?: { code?: number; message: string }): void
}

/** gRPC status codes the connector acts on. */
export const GRPC_UNAUTHENTICATED = 16
export const GRPC_ENDED = 9

/**
 * Opens YouTube's server-streaming chat call in the core (a web page can't speak gRPC). The core
 * adds the token, so none is passed here. Returns a function that cancels the stream.
 */
export function openStream(liveChatId: string, pageToken: string | undefined, h: StreamHandlers): () => void {
  let id = 0
  let done = false
  const stops: (() => void)[] = []
  const end = (err?: { code?: number; message: string }): void => {
    if (done) return
    done = true
    for (const s of stops) s()
    h.onEnd(err)
  }
  void (async () => {
    // Listeners first, so nothing the stream sends right away is missed.
    const queue: { kind: 'items' | 'end'; payload: any }[] = []
    stops.push(await listen<any>('youtube:items', (e) => (id ? e.payload.id === id && h.onItems(e.payload.items ?? [], e.payload.next ?? undefined) : queue.push({ kind: 'items', payload: e.payload }))))
    stops.push(await listen<any>('youtube:end', (e) => {
      if (!id) return void queue.push({ kind: 'end', payload: e.payload })
      if (e.payload.id === id) end(e.payload.code ? { code: e.payload.code, message: e.payload.message } : undefined)
    }))
    if (done) return void stops.forEach((s) => s())
    id = await invoke<number>('youtube_stream_start', { liveChatId, pageToken: pageToken ?? null })
    for (const q of queue) {
      if (q.payload.id !== id) continue
      if (q.kind === 'items') h.onItems(q.payload.items ?? [], q.payload.next ?? undefined)
      else end(q.payload.code ? { code: q.payload.code, message: q.payload.message } : undefined)
    }
    if (done) void invoke('youtube_stream_stop', { id })
  })().catch((err) => end({ message: String(err) }))
  return () => {
    if (id) void invoke('youtube_stream_stop', { id })
    done = true
    for (const s of stops) s()
  }
}
