import { useEffect, useMemo, useSyncExternalStore } from 'react'
import { chatEventGroup } from '../../shared/events'
import type { Bootstrap, ChatEventGroup, ChatMessage, ConnectionState, HubBatch, HypeTrain, Platform, Settings, StreamEvent, SecretState } from '../../shared/types'

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
}

let state: State = { ready: false, boot: null, settings: null, secrets: { youtubeSecret: false, kickSecret: false }, messages: [], events: [], statuses: {}, unreadEvents: 0, pronouns: {}, hype: null, actionsVersion: {} }
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
  if (b.deleted.length || b.purged.length) {
    const ids = new Set(b.deleted)
    messages = messages.map((m) => (
      ids.has(m.id) || b.purged.some((p) => p.platform === m.platform && (!p.userId || p.userId === m.author.id)) ? { ...m, deleted: true } : m
    ))
  }
  const events = incoming.events.length ? state.events.concat(incoming.events).slice(-MAX_EVENTS) : state.events
  const statuses = { ...state.statuses }
  for (const s of b.statuses) statuses[s.platform] = s
  const pronouns = Object.keys(b.pronouns).length ? { ...state.pronouns, ...b.pronouns } : state.pronouns
  const hype = b.hype === undefined ? state.hype : b.hype
  let actionsVersion = state.actionsVersion
  for (const p of b.actionsChanged ?? []) actionsVersion = { ...actionsVersion, [p]: (actionsVersion[p] ?? 0) + 1 }
  set({ messages, events, statuses, pronouns, hype, actionsVersion, unreadEvents: eventsOpen ? 0 : state.unreadEvents + incoming.events.length })
}

async function init(): Promise<void> {
  window.nnf.onBatch(apply)
  window.nnf.onSettings((settings) => set({ settings }))
  const boot = await window.nnf.bootstrap()
  snapshotIds = new Set([...boot.messages, ...boot.events].map((x) => x.id))
  set({
    ready: true, boot, settings: boot.settings, secrets: boot.secrets, messages: boot.messages, events: boot.events, pronouns: boot.pronouns, hype: boot.hype,
    statuses: Object.fromEntries(boot.statuses.map((s) => [s.platform, s]))
  })
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
    if (tab !== 'all' && m.platform !== tab) return false
    const group = m.event && chatEventGroup(m.event.type)
    return !group || on[group]
  }), [items, tab, on])
}

export function connected(s: Partial<Record<Platform, ConnectionState>>, p: Platform): boolean {
  const st = s[p]?.status
  return st === 'connected' || st === 'reconnecting' || st === 'waiting'
}
