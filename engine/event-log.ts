import { plainNote } from '../shared/events'
import type { StreamEvent } from '../shared/types'
import { core } from './core'

const KEEP = 500
const KEEP_REMOVED = 5000

async function readList(name: string): Promise<unknown[]> {
  try {
    const list = JSON.parse((await core.readFile(name)) ?? '[]')
    return Array.isArray(list) ? list : []
  } catch {
    return []
  }
}

/** Recent events from earlier sessions (user-data/events.json) so the Events list isn't empty on start. */
export async function loadEvents(): Promise<StreamEvent[]> {
  const list = (await readList('events.json')) as any[]
  // stale Fulfil/Refund buttons could act on old redemptions, so drop those
  return list.filter((e) => e && typeof e.id === 'string' && typeof e.ts === 'number' && !e.test && e.type !== 'clip').map(({ actions: _old, ...e }) => cleanBmc({ ...e, history: true }))
}

/** Buy Me a Coffee notes saved before 0.3.2 still have the HTML BMC sends ("<br>Name"). */
export function cleanBmc<T extends Pick<StreamEvent, 'source' | 'message' | 'actor'>>(e: T): T {
  return e.source === 'buymeacoffee' && e.message ? { ...e, message: plainNote(e.message, e.actor) } : e
}

export function saveEvents(events: StreamEvent[]): void {
  // test alerts only live until the app closes
  const recent = events.filter((e) => !e.test).sort((a, b) => a.ts - b.ts).slice(-KEEP)
  // nice to have, live events don't depend on it
  void core.writeFile('events.json', JSON.stringify(recent)).catch(() => {})
}

/** IDs the user removed, so reloading history from the platforms doesn't bring them back. */
export async function loadRemoved(): Promise<string[]> {
  return (await readList('events-removed.json')).filter((x): x is string => typeof x === 'string')
}

export function saveRemoved(ids: string[]): void {
  void core.writeFile('events-removed.json', JSON.stringify(ids.slice(-KEEP_REMOVED))).catch(() => {})
}
