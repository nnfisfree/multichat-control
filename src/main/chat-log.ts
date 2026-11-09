import { app } from 'electron'
import { appendFileSync, existsSync, mkdirSync, readdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import type { ChatMessage, HistorySession, Platform } from '../shared/types'

/** Chat after a quiet gap this long belongs to a new stream. */
const GAP_MS = 2 * 60 * 60 * 1000
const KEEP_STREAMS = 5
/** Each stream keeps at most this many messages, so files stay light. */
const MAX_PER_STREAM = 5000
const FLUSH_MS = 3000

type Line =
  | { m: ChatMessage }
  | { d: string }
  | { p: { platform: Platform; userId?: string; ts: number } }

const dir = (): string => join(app.getPath('userData'), 'chat-history')
const fileOf = (id: string): string => join(dir(), `${id}.jsonl`)

/** Keeps only what's needed to show a message again. Deleted text is never stored. */
function compact(m: ChatMessage): ChatMessage {
  const { event, ...rest } = m
  return {
    ...rest,
    parts: m.deleted ? [] : m.parts,
    ...(event ? { event: { ...event, actions: undefined } } : {})
  }
}

function parse(file: string): Line[] {
  try {
    return readFileSync(file, 'utf8').split('\n').flatMap((l) => {
      if (!l) return []
      try {
        return [JSON.parse(l) as Line]
      } catch {
        return []
      }
    })
  } catch {
    return []
  }
}

/**
 * Records chat to one small file per stream, beside the app, and keeps the last five streams.
 * Deletions and bans are recorded too, so removed messages never come back readable.
 */
export class ChatLog {
  private current: { id: string; count: number; last: number } | null = null
  private buffer: string[] = []
  private timer: NodeJS.Timeout | null = null

  constructor(private enabled: () => boolean) {}

  /** Continues the latest stream if chat stopped only a short while ago, such as after a restart. */
  init(): void {
    const latest = this.ids().at(-1)
    if (!latest) return
    const msgs = parse(fileOf(latest)).flatMap((l) => ('m' in l ? [l.m] : []))
    const last = msgs.at(-1)?.ts ?? 0
    if (Date.now() - last < GAP_MS) this.current = { id: latest, count: msgs.length, last }
  }

  private ids(): string[] {
    try {
      return readdirSync(dir()).filter((f) => /^stream-\d+\.jsonl$/.test(f)).map((f) => f.slice(0, -6)).sort()
    } catch {
      return []
    }
  }

  add(m: ChatMessage): void {
    if (!this.enabled()) return
    if (!this.current || m.ts - this.current.last > GAP_MS) {
      this.flush()
      this.current = { id: `stream-${m.ts}`, count: 0, last: m.ts }
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
    this.buffer.push(JSON.stringify(line))
    this.timer ??= setTimeout(() => this.flush(), FLUSH_MS)
  }

  flush(): void {
    if (this.timer) clearTimeout(this.timer)
    this.timer = null
    if (!this.current || !this.buffer.length) return
    try {
      mkdirSync(dir(), { recursive: true })
      appendFileSync(fileOf(this.current.id), this.buffer.join('\n') + '\n')
      this.buffer = []
      // A very busy stream is trimmed to its most recent messages now and then.
      if (this.current.count > MAX_PER_STREAM * 1.2) this.trim(this.current.id)
    } catch {
      // History is a convenience: chat keeps working without it.
      this.buffer = []
    }
  }

  private trim(id: string): void {
    const lines = parse(fileOf(id))
    const keep = this.messages(lines).slice(-MAX_PER_STREAM)
    writeFileSync(fileOf(id), keep.map((m) => JSON.stringify({ m })).join('\n') + '\n')
    if (this.current?.id === id) this.current.count = keep.length
  }

  private prune(): void {
    const ids = this.ids()
    for (const id of ids.slice(0, Math.max(0, ids.length - (KEEP_STREAMS - 1)))) rmSync(fileOf(id), { force: true })
  }

  /** Applies recorded deletions and bans to the stored messages. */
  private messages(lines: Line[]): ChatMessage[] {
    const out: ChatMessage[] = []
    const byId = new Map<string, ChatMessage>()
    for (const l of lines) {
      if ('m' in l) {
        out.push(l.m)
        byId.set(l.m.id, l.m)
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

  /** One user's messages across the saved streams, and in how many streams they chatted. */
  messagesBy(platform: Platform, userId: string): { messages: ChatMessage[]; streams: Set<string>; total: number } {
    this.flush()
    const streams = new Set<string>()
    const messages: ChatMessage[] = []
    for (const id of this.ids()) {
      const mine = this.messages(parse(fileOf(id))).filter((m) => m.platform === platform && m.author.id === userId && m.kind !== 'event')
      if (mine.length) streams.add(id)
      messages.push(...mine.map((m) => ({ ...m, history: true })))
    }
    return { messages, streams, total: messages.length }
  }

  /** The saved streams, newest last. */
  sessions(): HistorySession[] {
    this.flush()
    return this.ids().flatMap((id) => {
      const msgs = this.messages(parse(fileOf(id)))
      if (!msgs.length) return []
      return [{ id, start: msgs[0].ts, end: msgs.at(-1)!.ts, count: msgs.length }]
    })
  }

  load(id: string): ChatMessage[] {
    if (!/^stream-\d+$/.test(id)) return []
    this.flush()
    return this.messages(parse(fileOf(id))).map((m) => ({ ...m, history: true }))
  }

  /** Deletes every saved stream. */
  clear(): void {
    if (this.timer) clearTimeout(this.timer)
    this.timer = null
    this.buffer = []
    this.current = null
    if (existsSync(dir())) rmSync(dir(), { recursive: true, force: true })
  }
}
