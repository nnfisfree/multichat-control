import type { ChatMessage, HistorySession, Platform } from '../shared/types'
import { core } from './core'
import { cleanBmc } from './event-log'

// After a gap this long with no chat, assume it's a new stream.
const GAP_MS = 2 * 60 * 60 * 1000
const KEEP_STREAMS = 5
// per-stream cap so the files stay small
const MAX_PER_STREAM = 5000
const FLUSH_MS = 3000

type Line =
  | { m: ChatMessage }
  | { d: string }
  | { p: { platform: Platform; userId?: string; ts: number } }

const fileOf = (id: string): string => `chat-history/${id}.jsonl`

/** Strips a message down to what's needed to show it again. Deleted text is never written. */
function compact(m: ChatMessage): ChatMessage {
  const { event, ...rest } = m
  return {
    ...rest,
    parts: m.deleted ? [] : m.parts,
    ...(event ? { event: { ...event, actions: undefined } } : {})
  }
}

function parse(text: string | null): Line[] {
  return (text ?? '').split('\n').flatMap((l) => {
    if (!l) return []
    try {
      return [JSON.parse(l) as Line]
    } catch {
      return []
    }
  })
}

/**
 * Writes chat to one small file per stream under user-data/chat-history and keeps the last five
 * streams. Deletions and bans get logged too, so removed messages don't come back when history
 * loads. Everything is read once at startup and kept in memory; new lines are appended every few
 * seconds. The file format matches the old Electron build so upgrading keeps people's history.
 */
export class ChatLog {
  private streams = new Map<string, Line[]>()
  private current: { id: string; count: number; last: number } | null = null
  private buffer: string[] = []
  private timer: ReturnType<typeof setTimeout> | null = null

  constructor(private enabled: () => boolean) {}

  /** Loads saved streams and picks the latest one back up if chat only stopped a little while ago. */
  async init(): Promise<void> {
    const names = await core.listFolder('chat-history').catch((): string[] => [])
    for (const name of names) {
      const id = name.slice('chat-history/'.length, -'.jsonl'.length)
      if (/^stream-\d+$/.test(id)) this.streams.set(id, parse(await core.readFile(name).catch(() => null)))
    }
    const latest = this.ids().at(-1)
    if (!latest) return
    const msgs = this.messages(this.streams.get(latest)!)
    const last = msgs.at(-1)?.ts ?? 0
    if (Date.now() - last < GAP_MS) this.current = { id: latest, count: msgs.length, last }
  }

  private ids(): string[] {
    return [...this.streams.keys()].sort()
  }

  add(m: ChatMessage): void {
    if (!this.enabled()) return
    if (!this.current || m.ts - this.current.last > GAP_MS) {
      this.flush()
      this.current = { id: `stream-${m.ts}`, count: 0, last: m.ts }
      this.streams.set(this.current.id, [])
      this.prune()
    }
    this.current.count++
    this.current.last = Math.max(this.current.last, m.ts)
    this.write({ m: compact(m) })
  }

  deleted(id: string): void {
    if (this.current && this.enabled()) this.write({ d: id })
  }

  purged(platform: Platform, userId?: string): void {
    if (this.current && this.enabled()) this.write({ p: { platform, userId, ts: Date.now() } })
  }

  private write(line: Line): void {
    this.streams.get(this.current!.id)?.push(line)
    this.buffer.push(JSON.stringify(line))
    this.timer ??= setTimeout(() => this.flush(), FLUSH_MS)
  }

  flush(): void {
    if (this.timer) clearTimeout(this.timer)
    this.timer = null
    if (!this.current || !this.buffer.length) return
    const id = this.current.id
    const text = this.buffer.join('\n') + '\n'
    this.buffer = []
    // history is nice to have, chat keeps working if a write fails
    void core.appendFile(fileOf(id), text).catch(() => {})
    // busy streams get trimmed back to the newest messages now and then
    if (this.current.count > MAX_PER_STREAM * 1.2) this.trim(id)
  }

  private trim(id: string): void {
    const keep = this.messages(this.streams.get(id) ?? []).slice(-MAX_PER_STREAM)
    this.streams.set(id, keep.map((m) => ({ m })))
    void core.writeFile(fileOf(id), keep.map((m) => JSON.stringify({ m })).join('\n') + '\n').catch(() => {})
    if (this.current?.id === id) this.current.count = keep.length
  }

  private prune(): void {
    const ids = this.ids()
    for (const id of ids.slice(0, Math.max(0, ids.length - KEEP_STREAMS))) {
      this.streams.delete(id)
      void core.removeFile(fileOf(id)).catch(() => {})
    }
  }

  /** Replays logged deletions and bans over the stored messages. */
  private messages(lines: Line[]): ChatMessage[] {
    const out: ChatMessage[] = []
    const byId = new Map<string, ChatMessage>()
    for (const l of lines) {
      if ('m' in l) {
        const m = { ...l.m }
        out.push(m)
        byId.set(m.id, m)
      } else if ('d' in l) {
        const m = byId.get(l.d)
        if (m) Object.assign(m, { deleted: true, parts: [] })
      } else {
        for (const m of out) {
          if (m.platform === l.p.platform && m.ts <= l.p.ts && (!l.p.userId || m.author.id === l.p.userId)) Object.assign(m, { deleted: true, parts: [] })
        }
      }
    }
    return out
  }

  /** One user's messages across all saved streams, plus how many streams they showed up in. */
  messagesBy(platform: Platform, userId: string): { messages: ChatMessage[]; streams: Set<string>; total: number } {
    const streams = new Set<string>()
    const messages: ChatMessage[] = []
    for (const id of this.ids()) {
      const mine = this.messages(this.streams.get(id)!).filter((m) => m.platform === platform && m.author.id === userId && m.kind !== 'event')
      if (mine.length) streams.add(id)
      messages.push(...mine.map((m) => ({ ...m, history: true })))
    }
    return { messages, streams, total: messages.length }
  }

  /** Newest last. */
  sessions(): HistorySession[] {
    return this.ids().flatMap((id) => {
      const msgs = this.messages(this.streams.get(id)!)
      if (!msgs.length) return []
      return [{ id, start: msgs[0].ts, end: msgs.at(-1)!.ts, count: msgs.length }]
    })
  }

  load(id: string): ChatMessage[] {
    if (!/^stream-\d+$/.test(id)) return []
    return this.messages(this.streams.get(id) ?? []).map((m) => ({ ...m, ...(m.event ? { event: cleanBmc(m.event) } : {}), history: true }))
  }

  clear(): void {
    if (this.timer) clearTimeout(this.timer)
    this.timer = null
    this.buffer = []
    this.current = null
    this.streams.clear()
    void core.clearHistory().catch(() => {})
  }
}
