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

/** Recent events from earlier sessions (user-data/events.json), so the Events list isn't empty at start. */
export async function loadEvents(): Promise<StreamEvent[]> {
  const list = (await readList('events.json')) as any[]
  // Old Fulfil or Refund buttons could act on stale redemptions, so they are dropped.
  return list.filter((e) => e && typeof e.id === 'string' && typeof e.ts === 'number').map(({ actions: _old, ...e }) => ({ ...e, history: true }))
}

export function saveEvents(events: StreamEvent[]): void {
  const recent = [...events].sort((a, b) => a.ts - b.ts).slice(-KEEP)
  // Only a convenience: live events still work without it.
  void core.writeFile('events.json', JSON.stringify(recent)).catch(() => {})
}

/** Events the user removed, so history reloaded from the platforms doesn't bring them back. */
export async function loadRemoved(): Promise<string[]> {
  return (await readList('events-removed.json')).filter((x): x is string => typeof x === 'string')
}

export function saveRemoved(ids: string[]): void {
  void core.writeFile('events-removed.json', JSON.stringify(ids.slice(-KEEP_REMOVED))).catch(() => {})
}
