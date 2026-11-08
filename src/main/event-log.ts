import { app } from 'electron'
import { readFileSync, renameSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import type { StreamEvent } from '../shared/types'

const KEEP = 500
const file = (): string => join(app.getPath('userData'), 'events.json')

/** Recent events from earlier sessions, so the Events list isn't empty at start. */
export function loadEvents(): StreamEvent[] {
  try {
    const list = JSON.parse(readFileSync(file(), 'utf8'))
    if (!Array.isArray(list)) return []
    // Old Fulfil or Refund buttons could act on stale redemptions, so they are dropped.
    return list.filter((e) => e && typeof e.id === 'string' && typeof e.ts === 'number').map(({ actions: _old, ...e }) => ({ ...e, history: true }))
  } catch {
    return []
  }
}

export function saveEvents(events: StreamEvent[]): void {
  try {
    const recent = [...events].sort((a, b) => a.ts - b.ts).slice(-KEEP)
    writeFileSync(`${file()}.tmp`, JSON.stringify(recent))
    renameSync(`${file()}.tmp`, file())
  } catch {
    // Only a convenience: live events still work without it.
  }
}
