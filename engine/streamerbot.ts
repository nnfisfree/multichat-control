import { Socket as WebSocket } from './socket'
import type { ActionResult, SbAction, SbCommand, StreamerbotState, StreamEvent } from '../shared/types'
import { core } from './core'
import { SB_TEST_EVENTS, sbTestEvent } from './streamerbot-tests'
import { log } from './log'
import { backoff } from './net'
import { store } from './store'

// safety net in case SB's change events don't come through
const REFRESH_MS = 60000
// SB 0.2.4 and older never send Hello, so give up waiting after this
const HELLO_WAIT_MS = 1500
// events that mean an action or command was added, changed or removed
const CHANGE_EVENTS = ['ActionAdded', 'ActionUpdated', 'ActionDeleted', 'CommandAdded', 'CommandUpdated', 'CommandDeleted']

const text = (v: unknown): string => (typeof v === 'string' ? v.trim() : '')
// SB reports "no group" as the string "None"
const group = (v: unknown): string => (text(v).toLowerCase() === 'none' ? '' : text(v))
const byName = <T extends { group: string; name: string }>(a: T, b: T): number =>
  a.group.localeCompare(b.group, undefined, { sensitivity: 'base' }) || a.name.localeCompare(b.name, undefined, { sensitivity: 'base' })

/**
 * Talks to Streamer.bot's WebSocket server on this PC: lists its actions and chat commands, keeps
 * them in sync when they change there, and runs actions on request.
 */
export class StreamerbotLink {
  private ws: WebSocket | null = null
  private run = 0
  private attempt = 0
  private seq = 0
  private timer: ReturnType<typeof setTimeout> | null = null
  private helloTimer: ReturnType<typeof setTimeout> | null = null
  private refreshTimer: ReturnType<typeof setTimeout> | null = null
  private poll: ReturnType<typeof setInterval> | null = null
  private pending = new Map<string, (msg: any) => void>()
  private state: StreamerbotState = { status: 'off', actions: [], commands: [] }

  constructor(private send: (s: StreamerbotState) => void, private onTest: (e: StreamEvent) => void = () => {}) {}

  get(): StreamerbotState {
    return this.state
  }

  private set(next: Partial<StreamerbotState>): void {
    this.state = { ...this.state, ...next }
    this.send(this.state)
  }

  start(): void {
    this.stop()
    const run = ++this.run
    if (!store.settings.sbEnabled) return this.set({ status: 'off', detail: undefined, actions: [], commands: [] })
    this.set({ status: 'connecting', detail: undefined })
    this.open(run)
  }

  stop(): void {
    this.run++
    this.clearTimers()
    if (this.timer) clearTimeout(this.timer)
    this.timer = null
    for (const done of this.pending.values()) done(null)
    this.pending.clear()
    this.ws?.close()
    this.ws = null
  }

  private clearTimers(): void {
    if (this.helloTimer) clearTimeout(this.helloTimer)
    if (this.refreshTimer) clearTimeout(this.refreshTimer)
    if (this.poll) clearInterval(this.poll)
    this.helloTimer = this.refreshTimer = this.poll = null
  }

  private open(run: number): void {
    const port = Number(store.settings.sbPort) || 8080
    const ws = new WebSocket(`ws://127.0.0.1:${port}/`, { handshakeTimeout: 5000 })
    this.ws = ws
    // set once retrying is pointless (missing or wrong password)
    let refused = false
    let greeted = false
    let authenticating = false

    const ready = (version?: string): void => {
      if (run !== this.run || greeted) return
      greeted = true
      if (this.helloTimer) clearTimeout(this.helloTimer)
      this.attempt = 0
      log('streamerbot', `connected${version ? ` to ${version}` : ''}`)
      void this.afterConnect(run, version)
    }

    ws.on('open', () => {
      if (run !== this.run) return
      this.helloTimer = setTimeout(() => ready(), HELLO_WAIT_MS)
    })
    ws.on('message', (raw) => {
      if (run !== this.run) return
      let msg: any
      try {
        msg = JSON.parse(raw.toString())
      } catch {
        return
      }
      // reply to one of our requests
      if (typeof msg?.id === 'string' && this.pending.has(msg.id) && !msg.event) {
        const done = this.pending.get(msg.id)!
        this.pending.delete(msg.id)
        return done(msg)
      }
      if (msg?.request === 'Hello' && !greeted) {
        if (this.helloTimer) clearTimeout(this.helloTimer)
        const version = text(msg.info?.version) || undefined
        const auth = msg.authentication
        if (!auth?.salt || !auth?.challenge) return ready(version)
        void (async () => {
          if (!(await core.secretState()).sbPassword) {
            refused = true
            this.set({ status: 'error', detail: 'Streamer.bot asks for a password. Add it in Settings → Connections → Streamer.bot.' })
            return ws.close()
          }
          authenticating = true
          const authentication = await core.sbAuth(auth.salt, auth.challenge)
          const r = await this.request('Authenticate', { authentication })
          authenticating = false
          if (run !== this.run) return
          if (r?.status === 'ok') return ready(version)
          refused = true
          this.set({ status: 'error', detail: 'Streamer.bot refused the password. Copy it again from its WebSocket Server settings.' })
          ws.close()
        })()
        return
      }
      // something changed in SB, re-read the lists once it settles
      const source = text(msg?.event?.source).toLowerCase()
      if (source === 'application' && CHANGE_EVENTS.includes(text(msg?.event?.type))) return this.refreshSoon(run)
      // test trigger fired in SB; shows in Events until restart
      const test = source ? sbTestEvent(source, text(msg?.event?.type), msg?.data) : null
      if (test) this.onTest(test)
    })
    ws.on('error', () => {})
    ws.on('close', () => {
      if (run !== this.run || ws !== this.ws) return
      this.clearTimers()
      for (const done of this.pending.values()) done(null)
      this.pending.clear()
      // SB just drops the connection on a wrong password
      if (authenticating) {
        refused = true
        this.set({ status: 'error', detail: 'Streamer.bot refused the password. Copy it again from its WebSocket Server settings.' })
      }
      if (refused) return
      if (greeted) log('streamerbot', 'disconnected')
      this.set({ status: 'connecting', detail: `Waiting for Streamer.bot on port ${port}. Is it open, with its WebSocket Server started?` })
      this.timer = setTimeout(() => this.open(run), Math.min(15000, backoff(this.attempt++)))
    })
  }

  private async afterConnect(run: number, version?: string): Promise<void> {
    if (!version) {
      const info = await this.request('GetInfo')
      version = text(info?.info?.version) || undefined
    }
    if (run !== this.run) return
    this.set({ version })
    await this.refresh(run)
    await this.subscribe(run)
    if (run === this.run) this.poll = setInterval(() => void this.refresh(run), REFRESH_MS)
  }

  /** Subscribes to action/command changes and test triggers. */
  private async subscribe(run: number): Promise<void> {
    const list = await this.request('GetEvents')
    if (run !== this.run) return
    const events: Record<string, unknown> = list?.events && typeof list.events === 'object' ? list.events : {}
    // only the events this SB version actually offers, spelled the way it spells them
    const pick = (category: string, names: string[], ifUnknown: boolean): [string, string[]] => {
      const key = Object.keys(events).find((k) => k.toLowerCase() === category.toLowerCase())
      const offered = key && Array.isArray(events[key]) ? (events[key] as unknown[]).map(text) : []
      if (!offered.length) return [key ?? category, ifUnknown ? names : []]
      return [key!, names.map((n) => offered.find((o) => o.toLowerCase() === n.toLowerCase())).filter((o): o is string => !!o)]
    }
    const [appKey, app] = pick('Application', CHANGE_EVENTS, true)
    if (app.length) {
      const r = await this.request('Subscribe', { events: { [appKey]: app } })
      if (r?.status !== 'ok') log('streamerbot', `could not subscribe to changes (${text(r?.error) || 'no answer'}); the lists refresh every minute instead`)
    }
    if (run !== this.run) return
    // test triggers go in a separate request, so an older SB refusing them can't break the one above
    const tests: Record<string, string[]> = {}
    for (const [category, names] of Object.entries(SB_TEST_EVENTS)) {
      const [key, wanted] = pick(category, names, false)
      if (wanted.length) tests[key] = wanted
    }
    if (!Object.keys(tests).length) return
    const r = await this.request('Subscribe', { events: tests })
    if (r?.status !== 'ok') log('streamerbot', `could not subscribe to test triggers (${text(r?.error) || 'no answer'})`)
  }

  private refreshSoon(run: number): void {
    if (this.refreshTimer) clearTimeout(this.refreshTimer)
    this.refreshTimer = setTimeout(() => void this.refresh(run), 400)
  }

  /** Re-reads actions and commands. Runs on connect, on changes, and once a minute. */
  async refresh(run = this.run): Promise<void> {
    const [a, c] = await Promise.all([this.request('GetActions'), this.request('GetCommands')])
    if (run !== this.run) return
    if (a?.status !== 'ok' || !Array.isArray(a.actions)) {
      if (this.state.status !== 'connected') this.set({ status: 'connected', detail: "Connected, but Streamer.bot didn't send its actions." })
      return
    }
    const actions: SbAction[] = a.actions
      .map((x: any) => ({ id: text(x?.id), name: text(x?.name), group: group(x?.group), enabled: x?.enabled !== false }))
      .filter((x: SbAction) => x.id && x.name)
      .sort(byName)
    // GetCommands needs SB 0.2.5+; older versions just don't get a command list
    const commands: SbCommand[] = c?.status === 'ok' && Array.isArray(c.commands)
      ? c.commands
        .map((x: any) => ({
          id: text(x?.id), name: text(x?.name), group: group(x?.group), enabled: x?.enabled !== false,
          commands: Array.isArray(x?.commands) ? x.commands.map(text).filter(Boolean) : []
        }))
        .filter((x: SbCommand) => x.id && x.commands.length)
        .sort(byName)
      : []
    this.set({ status: 'connected', detail: undefined, actions, commands })
  }

  /** `input` reaches the action the same way a chat command's text would: rawInput, input0, input1... */
  async runAction(id: string, input?: string): Promise<ActionResult> {
    if (this.state.status !== 'connected') return { ok: false, message: 'Streamer.bot is not connected.' }
    const action = this.state.actions.find((a) => a.id === id)
    if (!action) return { ok: false, message: 'That action is no longer in Streamer.bot.' }
    if (!action.enabled) return { ok: false, message: `"${action.name}" is turned off in Streamer.bot.` }
    const args: Record<string, string> = { triggeredBy: 'Multichat Control' }
    const raw = input?.trim()
    if (raw) {
      args.rawInput = raw
      raw.split(/\s+/).forEach((word, i) => { args[`input${i}`] = word })
    }
    const r = await this.request('DoAction', { action: { id }, args })
    if (r?.status === 'ok') {
      log('streamerbot', `ran action "${action.name}"`)
      return { ok: true, message: `Ran "${action.name}" in Streamer.bot.` }
    }
    return { ok: false, message: r ? `Streamer.bot couldn't run "${action.name}"${text(r.error) ? `: ${text(r.error)}` : '.'}` : "Streamer.bot didn't answer." }
  }

  private request(type: string, data?: Record<string, unknown>): Promise<any> {
    return new Promise((resolve) => {
      if (!this.ws || this.ws.readyState !== WebSocket.OPEN) return resolve(null)
      const id = `mc-${++this.seq}`
      this.pending.set(id, resolve)
      this.ws.send(JSON.stringify({ request: type, id, ...data }))
      setTimeout(() => {
        if (this.pending.delete(id)) resolve(null)
      }, 5000)
    })
  }
}
