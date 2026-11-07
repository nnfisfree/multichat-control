import * as grpc from '@grpc/grpc-js'
import * as protoLoader from '@grpc/proto-loader'
import { app } from 'electron'
import { join } from 'node:path'

let client: any = null

function getClient(): any {
  if (client) return client
  const base = app.isPackaged ? join(process.resourcesPath, 'proto') : join(app.getAppPath(), 'resources/proto')
  const def = protoLoader.loadSync(join(base, 'stream_list.proto'), { longs: String, enums: String, defaults: false, oneofs: false })
  const pkg = grpc.loadPackageDefinition(def) as any
  client = new pkg.youtube.api.v3.V3DataLiveChatMessageService('youtube.googleapis.com:443', grpc.credentials.createSsl())
  return client
}

export interface StreamHandlers {
  onItems(items: any[], nextPageToken?: string): void
  onEnd(error?: { code?: number; message: string }): void
}

/** Opens YouTube's server-streaming chat call. Returns a function that cancels it. */
export function openStream(liveChatId: string, pageToken: string | undefined, accessToken: string, h: StreamHandlers): () => void {
  const meta = new grpc.Metadata()
  meta.set('authorization', `Bearer ${accessToken}`)
  const call = getClient().StreamList({ liveChatId, pageToken, part: ['id', 'snippet', 'authorDetails'] }, meta)
  let done = false
  const end = (err?: { code?: number; message: string }): void => {
    if (done) return
    done = true
    h.onEnd(err)
  }
  call.on('data', (r: any) => h.onItems(r.items ?? [], r.nextPageToken))
  call.on('error', (err: grpc.ServiceError) => end(err.code === grpc.status.CANCELLED ? undefined : { code: err.code, message: err.details || err.message }))
  call.on('end', () => end())
  return () => {
    done = true
    call.cancel()
  }
}

export const GRPC_UNAUTHENTICATED = grpc.status.UNAUTHENTICATED
export const GRPC_ENDED = grpc.status.FAILED_PRECONDITION
