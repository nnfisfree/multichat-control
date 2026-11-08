import type { BrowserWindow } from 'electron'
import type { AlertContext } from './integrations/alerts'
import type { Connector, ConnectorContext } from './platforms/connector'
import { eventToMessage } from '../shared/events'
import { serializeFor } from '../shared/parts'
import type {
  ActionResult, AlertSource, ChatMessage, ConnectionState, Emote, HubBatch, HypeTrain, IntegrationState, ModerationRequest, Platform, SendResult, StreamEvent
} from '../shared/types'
import { PLATFORMS } from '../shared/types'
import { log } from './log'
import { message } from './net'

const MAX_MESSAGES = 3000
const MAX_EVENTS = 1500
const FLUSH_MS = 60
/** The same sub or raid reported by Twitch and by an alert service lands within this window. */
const TWIN_MS = 120000

const sameKind = (t: string): string => (t === 'bits' ? 'cheer' : t)

/** Merges connectors into one stream and batches updates so busy chats don't flood the UI. */
export class Hub {
  private connectors = new Map<Platform, Connector>()
  private statuses = new Map<Platform, ConnectionState>()
  private integrations = new Map<AlertSource, IntegrationState>()
  private messages: ChatMessage[] = []
  private events: StreamEvent[] = []
  private pronouns: Record<string, string> = {}
  private hype: HypeTrain | null = null
  private pending: HubBatch = emptyBatch()
  private timer: NodeJS.Timeout | null = null
  private window: BrowserWindow | null = null
  private eventIds = new Set<string>()
  private recorder: { add(m: ChatMessage): void; deleted(id: string): void; purged(platform: Platform, userId?: string): void } | null = null
  private removed = new Set<string>()
  private persistRemoved: ((ids: string[]) => void) | null = null
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

  /** Events the user removed earlier. They stay out even when history reloads them. */
  restoreRemoved(ids: string[], persist: (ids: string[]) => void): void {
    this.removed = new Set(ids)
    this.persistRemoved = persist
    this.events = this.events.filter((e) => !this.removed.has(e.id))
    this.eventIds = new Set(this.events.map((e) => e.id))
  }

  /** Removes events from the list for good, such as test redemptions. */
  removeEvents(ids: string[]): void {
    const gone = new Set(ids.filter((id) => typeof id === 'string'))
    if (!gone.size) return
    for (const id of gone) {
      this.removed.add(id)
      this.eventIds.delete(id)
    }
    this.events = this.events.filter((e) => !gone.has(e.id))
    this.persistRemoved?.([...this.removed])
    this.persistSoon()
  }

  private persistSoon(): void {
    if (!this.persist) return
    this.persistTimer ??= setTimeout(() => {
      this.persistTimer = null
      this.persist?.(this.events)
    }, 3000)
  }

  /** Saves chat for the history of past streams. */
  record(recorder: { add(m: ChatMessage): void; deleted(id: string): void; purged(platform: Platform, userId?: string): void }): void {
    this.recorder = recorder
  }

  /** Empties the chat kept in memory, as part of clearing the history. */
  clearMessages(): void {
    this.messages = []
  }

  private addMessage(m: ChatMessage): void {
    this.recorder?.add(m)
    this.messages.push(m)
    if (this.messages.length > MAX_MESSAGES) this.messages.splice(0, this.messages.length - MAX_MESSAGES)
    this.pending.messages.push(m)
    this.schedule()
  }

  /**
   * True when another source already reported this event: Twitch and StreamElements both see
   * the same sub, for example. Only events from different sources can be twins.
   */
  private twin(e: StreamEvent): boolean {
    const actor = e.actor?.toLowerCase()
    if (!actor) return false
    for (let i = this.events.length - 1, n = 0; i >= 0 && n < 800; i--, n++) {
      const o = this.events[i]
      if ((o.source ?? '') === (e.source ?? '') || o.platform !== e.platform || sameKind(o.type) !== sameKind(e.type)) continue
      if (o.actor?.toLowerCase() === actor && Math.abs(o.ts - e.ts) < TWIN_MS) return true
    }
    return false
  }

  private addEvent(e: StreamEvent): void {
    // History can overlap saved and live events, so each event is shown once.
    if (this.eventIds.has(e.id) || this.removed.has(e.id) || this.twin(e)) return
    this.eventIds.add(e.id)
    this.events.push(e)
    if (this.events.length > MAX_EVENTS) for (const old of this.events.splice(0, this.events.length - MAX_EVENTS)) this.eventIds.delete(old.id)
    this.persistSoon()
    this.pending.events.push(e)
    this.schedule()
    const card = eventToMessage(e)
    if (card) this.addMessage(card)
  }

  /** How StreamElements and Streamlabs report in. */
  alertContext(source: AlertSource): AlertContext {
    return {
      event: (e) => this.addEvent(e),
      status: (s) => {
        const state = { source, ...s }
        const before = this.integrations.get(source)
        if (before?.status !== state.status || before?.detail !== state.detail) log(source, `${state.status}${state.detail ? `: ${state.detail}` : ''}`)
        this.integrations.set(source, state)
        this.pending.integrations = [...(this.pending.integrations ?? []).filter((x) => x.source !== source), state]
        this.schedule()
      },
      home: () => {
        const live = (p: Platform): boolean => ['connected', 'waiting', 'reconnecting'].includes(this.statuses.get(p)?.status ?? '')
        return PLATFORMS.find(live) ?? 'twitch'
      }
    }
  }

  context(platform: Platform): ConnectorContext {
    return {
      message: (m) => this.addMessage(m),
      event: (e) => this.addEvent(e),
      deleted: (id) => {
        this.recorder?.deleted(id)
        const m = this.messages.find((x) => x.id === id)
        if (m) m.deleted = true
        this.pending.deleted.push(id)
        this.schedule()
      },
      purged: (userId) => {
        this.recorder?.purged(platform, userId)
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
      hype: this.hype,
      integrations: [...this.integrations.values()]
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
