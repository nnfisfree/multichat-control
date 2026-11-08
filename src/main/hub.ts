import type { BrowserWindow } from 'electron'
import type { Connector, ConnectorContext } from './platforms/connector'
import { eventToMessage } from '../shared/events'
import { serializeFor } from '../shared/parts'
import type {
  ActionResult, ChatMessage, ConnectionState, Emote, HubBatch, HypeTrain, ModerationRequest, Platform, SendResult, StreamEvent
} from '../shared/types'
import { PLATFORMS } from '../shared/types'
import { log } from './log'
import { message } from './net'

const MAX_MESSAGES = 3000
const MAX_EVENTS = 1500
const FLUSH_MS = 60

/** Merges connectors into one stream and batches updates so busy chats don't flood the UI. */
export class Hub {
  private connectors = new Map<Platform, Connector>()
  private statuses = new Map<Platform, ConnectionState>()
  private messages: ChatMessage[] = []
  private events: StreamEvent[] = []
  private pronouns: Record<string, string> = {}
  private hype: HypeTrain | null = null
  private pending: HubBatch = emptyBatch()
  private timer: NodeJS.Timeout | null = null
  private window: BrowserWindow | null = null
  private eventIds = new Set<string>()
  private persist: ((events: StreamEvent[]) => void) | null = null
  private persistTimer: NodeJS.Timeout | null = null

  register(connector: Connector): void {
    this.connectors.set(connector.platform, connector)
  }

  attach(window: BrowserWindow): void {
    this.window = window
  }

  /** Events from earlier sessions. They load before the window, so the first snapshot has them. */
  restoreEvents(events: StreamEvent[], persist: (events: StreamEvent[]) => void): void {
    this.persist = persist
    this.events = [...events].sort((a, b) => a.ts - b.ts).slice(-MAX_EVENTS)
    this.eventIds = new Set(this.events.map((e) => e.id))
  }

  private persistSoon(): void {
    if (!this.persist) return
    this.persistTimer ??= setTimeout(() => {
      this.persistTimer = null
      this.persist?.(this.events)
    }, 3000)
  }

  private addMessage(m: ChatMessage): void {
    this.messages.push(m)
    if (this.messages.length > MAX_MESSAGES) this.messages.splice(0, this.messages.length - MAX_MESSAGES)
    this.pending.messages.push(m)
    this.schedule()
  }

  context(platform: Platform): ConnectorContext {
    return {
      message: (m) => this.addMessage(m),
      event: (e) => {
        // History can overlap saved and live events, so each event is shown once.
        if (this.eventIds.has(e.id)) return
        this.eventIds.add(e.id)
        this.events.push(e)
        if (this.events.length > MAX_EVENTS) for (const old of this.events.splice(0, this.events.length - MAX_EVENTS)) this.eventIds.delete(old.id)
        this.persistSoon()
        this.pending.events.push(e)
        this.schedule()
        const card = eventToMessage(e)
        if (card) this.addMessage(card)
      },
      deleted: (id) => {
        const m = this.messages.find((x) => x.id === id)
        if (m) m.deleted = true
        this.pending.deleted.push(id)
        this.schedule()
      },
      purged: (userId) => {
        for (const m of this.messages) if (m.platform === platform && (!userId || m.author.id === userId)) m.deleted = true
        this.pending.purged.push({ platform, userId })
        this.schedule()
      },
      hype: (train) => {
        this.hype = train
        this.pending.hype = train
        this.schedule()
      },
      actionsChanged: () => {
        this.pending.actionsChanged = [...new Set([...(this.pending.actionsChanged ?? []), platform])]
        this.schedule()
      },
      pronoun: (login, label) => {
        this.pronouns[login] = label
        this.pending.pronouns[login] = label
        this.schedule()
      },
      status: (s) => {
        const state = { platform, ...s }
        const before = this.statuses.get(platform)
        if (before?.status !== state.status || before?.detail !== state.detail) log(platform, `${state.status}${state.detail ? `: ${state.detail}` : ''}`)
        this.statuses.set(platform, state)
        this.pending.statuses.push(state)
        this.schedule()
      }
    }
  }

  private schedule(): void {
    this.timer ??= setTimeout(() => {
      this.timer = null
      const batch = this.pending
      this.pending = emptyBatch()
      if (this.window && !this.window.isDestroyed()) this.window.webContents.send('hub:batch', batch)
    }, FLUSH_MS)
  }

  snapshot() {
    return {
      statuses: PLATFORMS.map((p) => this.statuses.get(p) ?? ({ platform: p, status: 'disabled' } as ConnectionState)),
      messages: this.messages,
      events: this.events,
      pronouns: this.pronouns,
      hype: this.hype
    }
  }

  get(platform: Platform): Connector {
    const c = this.connectors.get(platform)
    if (!c) throw new Error(`${platform} is not available.`)
    return c
  }

  async startAll(): Promise<void> {
    await Promise.all([...this.connectors.values()].map((c) => c.start().catch((err) => {
      this.context(c.platform).status({ status: 'error', detail: message(err) })
    })))
  }

  async refreshEmotes(): Promise<void> {
    await Promise.allSettled([...this.connectors.values()].map((c) => c.refreshEmotes()))
  }

  async stopAll(): Promise<void> {
    if (this.persistTimer) clearTimeout(this.persistTimer)
    this.persist?.(this.events)
    await Promise.allSettled([...this.connectors.values()].map((c) => c.stop()))
  }

  /** Sends to each target independently, so one failing platform never blocks the others. */
  async send(targets: Platform[], text: string, replyTo?: { platform: Platform; messageId: string }): Promise<SendResult[]> {
    return Promise.all(targets.map(async (platform): Promise<SendResult> => {
      try {
        const c = this.get(platform)
        const emotes = platform === 'kick' ? await c.emotes().catch((): Emote[] => []) : []
        await c.send(serializeFor(platform, text, emotes), replyTo?.platform === platform ? replyTo.messageId : undefined)
        return { platform, ok: true }
      } catch (err) {
        return { platform, ok: false, error: message(err) }
      }
    }))
  }

  async moderate(platform: Platform, req: ModerationRequest): Promise<ActionResult> {
    try {
      return await this.get(platform).moderate(req)
    } catch (err) {
      return { ok: false, message: message(err) }
    }
  }

  async runAction(platform: Platform, actionId: string, args: Record<string, string>): Promise<ActionResult> {
    try {
      return await this.get(platform).runAction(actionId, args)
    } catch (err) {
      return { ok: false, message: message(err) }
    }
  }
}

function emptyBatch(): HubBatch {
  return { messages: [], events: [], deleted: [], purged: [], statuses: [], pronouns: {} }
}
