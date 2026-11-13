import { useEffect, useMemo, useSyncExternalStore } from 'react'
import { chatEventGroup } from '../../shared/events'
import { PLATFORMS } from '../../shared/types'
import { isReloginNotice, reloginDone } from '../../shared/relogin'
import type { AlertSource, HistorySession, ObsState, StreamerbotState, PinnedMessage, PlatformUsers, RaidInfo, Bootstrap, ChatEventGroup, ChatMessage, ConnectionState, HubBatch, HypeTrain, IntegrationState, Platform, Settings, StreamEvent, SecretState, UpdateState } from '../../shared/types'

const MAX_MESSAGES = 3000
const MAX_EVENTS = 1500
/** Hard ceiling even while paused, so a forgotten pause can't grow without limit. */
const MAX_HELD = 20000

export interface State {
  ready: boolean
  boot: Bootstrap | null
  settings: Settings | null
  secrets: SecretState
  messages: ChatMessage[]
  events: StreamEvent[]
  statuses: Partial<Record<Platform, ConnectionState>>
  unreadEvents: number
  pronouns: Record<string, string>
  hype: HypeTrain | null
  actionsVersion: Partial<Record<Platform, number>>
  update: UpdateState | null
  integrations: Partial<Record<AlertSource, IntegrationState>>
  panelSignedIn: boolean | null
  /** Chat from past streams, oldest first, with a divider before each stream. */
  history: ChatMessage[]
  historySessions: HistorySession[]
  /** How many of the saved streams are shown, counted from the newest. */
  historyShown: number
  /** Who is in chat on each platform, refreshed every minute and while the list is open. */
  users: Partial<Record<Platform, PlatformUsers>>
  obs: ObsState
  streamerbot: StreamerbotState
  pinned: PinnedMessage | null
  raid: RaidInfo | null
}

let state: State = { ready: false, boot: null, settings: null, secrets: { youtubeSecret: false, kickSecret: false, obsPassword: false, sbPassword: false }, messages: [], events: [], statuses: {}, unreadEvents: 0, pronouns: {}, hype: null, actionsVersion: {}, update: null, integrations: {}, panelSignedIn: null, history: [], historySessions: [], historyShown: 0, users: {}, obs: { status: 'off' }, streamerbot: { status: 'off', actions: [], commands: [] }, pinned: null, raid: null }
const listeners = new Set<() => void>()
let eventsOpen = false
/** While the user reads back through chat, old rows stay so their scroll position holds. */
let holdHistory = false

function set(next: Partial<State>): void {
  state = { ...state, ...next }
  listeners.forEach((l) => l())
}

/** Items in the startup snapshot can also arrive in the first live batch. */
let snapshotIds = new Set<string>()

function apply(b: HubBatch): void {
  const incoming = { messages: b.messages.filter((m) => !snapshotIds.has(m.id)), events: b.events.filter((e) => !snapshotIds.has(e.id)) }
  let messages = state.messages
  if (incoming.messages.length) {
    messages = messages.concat(incoming.messages)
    const limit = holdHistory ? MAX_HELD : MAX_MESSAGES
    if (messages.length > limit) messages = messages.slice(messages.length - limit)
  }
  if (b.updated?.length) {
    const changed = new Map(b.updated.map((m) => [m.id, m]))
    messages = messages.map((m) => changed.get(m.id) ?? m)
  }
  if (b.deleted.length || b.purged.length) {
    const ids = new Set(b.deleted)
    messages = messages.map((m) => (
      ids.has(m.id) || b.purged.some((p) => p.platform === m.platform && (!p.userId || p.userId === m.author.id)) ? { ...m, deleted: true } : m
    ))
  }
  const events = incoming.events.length ? state.events.concat(incoming.events).slice(-MAX_EVENTS) : state.events
  const statuses = { ...state.statuses }
  for (const s of b.statuses) statuses[s.platform] = s
  retireRelogin(b.statuses.map((s) => s.platform))
  const pronouns = Object.keys(b.pronouns).length ? { ...state.pronouns, ...b.pronouns } : state.pronouns
  const hype = b.hype === undefined ? state.hype : b.hype
  let actionsVersion = state.actionsVersion
  for (const p of b.actionsChanged ?? []) actionsVersion = { ...actionsVersion, [p]: (actionsVersion[p] ?? 0) + 1 }
  const pinned = b.pinned === undefined ? state.pinned : b.pinned
  const raid = b.raid === undefined ? state.raid : b.raid
  const integrations = b.integrations?.length ? { ...state.integrations, ...Object.fromEntries(b.integrations.map((i) => [i.source, i])) } : state.integrations
  set({ messages, events, statuses, pronouns, hype, actionsVersion, integrations, pinned, raid, unreadEvents: eventsOpen ? 0 : state.unreadEvents + incoming.events.filter((e) => !e.history).length })
}

/** How long a retired "log in again" notice takes to fade out; matches .relogin-done in theme.css. */
const RELOGIN_FADE_MS = 600
let reloginTimer: ReturnType<typeof setTimeout> | null = null

/**
 * Once a platform connects with a login that has every permission, its "log in again" notices
 * fade (ChatRow sees the same status) and are then removed. The timer doesn't depend on the row
 * being on screen, so notices scrolled out of view go too.
 */
function retireRelogin(platforms: Platform[]): void {
  if (!platforms.length || reloginTimer) return
  reloginTimer = setTimeout(() => {
    reloginTimer = null
    const gone = (m: ChatMessage): boolean => isReloginNotice(m) && reloginDone(state.statuses[m.platform])
    if (state.messages.some(gone)) set({ messages: state.messages.filter((m) => !gone(m)) })
  }, RELOGIN_FADE_MS)
}

async function init(): Promise<void> {
  window.nnf.onBatch(apply)
  window.nnf.onSettings((settings) => set({ settings }))
  window.nnf.onUpdate((update) => set({ update }))
  window.nnf.onPanelSignedIn((panelSignedIn) => set({ panelSignedIn }))
  window.nnf.onObs((obs) => set({ obs }))
  window.nnf.onStreamerbot((streamerbot) => set({ streamerbot }))
  const boot = await window.nnf.bootstrap()
  snapshotIds = new Set([...boot.messages, ...boot.events].map((x) => x.id))
  set({
    ready: true, boot, settings: boot.settings, secrets: boot.secrets, messages: boot.messages, events: boot.events, pronouns: boot.pronouns, hype: boot.hype, update: boot.update,
    statuses: Object.fromEntries(boot.statuses.map((s) => [s.platform, s])),
    integrations: Object.fromEntries(boot.integrations.map((i) => [i.source, i])),
    panelSignedIn: boot.panelSignedIn,
    obs: boot.obs,
    streamerbot: boot.streamerbot,
    pinned: boot.pinned,
    raid: boot.raid
  })
  // The latest past stream shows above this one; older ones load on request.
  const sessions = await window.nnf.history.sessions().catch((): HistorySession[] => [])
  set({ historySessions: sessions })
  if (sessions.length) await loadOlderHistory()
  // The viewer count beside the users button stays fresh even while the list is closed.
  setTimeout(() => void refreshUsers(), 8000)
  setInterval(() => void refreshUsers(), 60000)
}

const when = (ts: number): string => new Date(ts).toLocaleString([], { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' })
const divider = (id: string, ts: number, text: string): ChatMessage => ({
  id: `divider-${id}`, platform: 'twitch', ts, kind: 'system', divider: text, author: { id: '', name: '', badges: [] }, parts: []
})

/** Shows the stream before the ones already shown. The first call shows the latest stream. */
export async function loadOlderHistory(): Promise<void> {
  const sessions = state.historySessions
  const next = sessions[sessions.length - 1 - state.historyShown]
  if (!next) return
  const live = new Set(state.messages.map((m) => m.id))
  const msgs = (await window.nnf.history.load(next.id)).filter((m) => !live.has(m.id))
  const count = `${next.count.toLocaleString()} message${next.count === 1 ? '' : 's'}`
  const rows = [divider(next.id, next.start, `Stream of ${when(next.start)} · ${count}`), ...msgs]
  // The first stream shown also gets a line marking where this session starts.
  const now = state.historyShown === 0 ? [divider('now', Date.now(), 'This session')] : []
  set({ history: [...rows, ...state.history, ...now], historyShown: state.historyShown + 1 })
}

let usersBusy = false
/** Reloads who is in chat on every connected platform. */
export async function refreshUsers(): Promise<void> {
  if (usersBusy) return
  usersBusy = true
  try {
    const live = PLATFORMS.filter((p) => connected(state.statuses, p))
    const results = await Promise.all(live.map((p) => window.nnf.users(p).catch(() => null)))
    const users: State['users'] = {}
    for (const r of results) if (r) users[r.platform] = r
    set({ users })
  } finally {
    usersBusy = false
  }
}

/** Clears chat here and deletes the saved history of past streams. Viewers' chat isn't touched. */
export async function clearHistory(): Promise<void> {
  await window.nnf.history.clear()
  set({ history: [], historySessions: [], historyShown: 0, messages: [] })
}

/** Removes events for good, here and in the saved list. */
export async function removeEvents(ids: string[]): Promise<void> {
  if (!ids.length) return
  await window.nnf.removeEvents(ids)
  const gone = new Set(ids)
  set({ events: state.events.filter((e) => !gone.has(e.id)) })
}

export const setEventsOpen = (open: boolean): void => {
  eventsOpen = open
  if (open) set({ unreadEvents: 0 })
}

export const setHoldHistory = (hold: boolean): void => {
  holdHistory = hold
}

export async function updateSettings(patch: Partial<Settings>): Promise<void> {
  set({ settings: { ...state.settings!, ...patch } })
  set({ settings: await window.nnf.saveSettings(patch) })
}

export const setSecrets = (secrets: SecretState): void => set({ secrets })

export function useStore<T>(pick: (s: State) => T): T {
  return useSyncExternalStore((l) => {
    listeners.add(l)
    return () => listeners.delete(l)
  }, () => pick(state))
}

export function useInit(): void {
  useEffect(() => {
    void init()
  }, [])
}

export function useFiltered(items: ChatMessage[], tab: Platform | 'all', on: Record<ChatEventGroup, boolean>): ChatMessage[] {
  return useMemo(() => items.filter((m) => {
    if (m.divider) return true
    if (tab !== 'all' && m.platform !== tab) return false
    const group = m.event && chatEventGroup(m.event.type)
    // Groups added after a settings file was saved start on.
    return !group || (on[group] ?? true)
  }), [items, tab, on])
}

export function connected(s: Partial<Record<Platform, ConnectionState>>, p: Platform): boolean {
  const st = s[p]?.status
  return st === 'connected' || st === 'reconnecting' || st === 'waiting'
}
