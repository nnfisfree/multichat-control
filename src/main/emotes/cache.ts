import { app } from 'electron'
import { mkdirSync, readFileSync, renameSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import type { Emote } from '../../shared/types'

const file = (key: string): string => join(app.getPath('userData'), 'emote-cache', `${key.replace(/[^\w-]/g, '_')}.json`)

/** Lists saved last session open instantly, while a fresh copy loads in the background. */
export function loadEmoteCache(key: string): Emote[] | null {
  try {
    const list = JSON.parse(readFileSync(file(key), 'utf8'))
    return Array.isArray(list) && list.length ? list : null
  } catch {
    return null
  }
}

export function saveEmoteCache(key: string, list: Emote[]): void {
  try {
    mkdirSync(join(app.getPath('userData'), 'emote-cache'), { recursive: true })
    writeFileSync(`${file(key)}.tmp`, JSON.stringify(list))
    renameSync(`${file(key)}.tmp`, file(key))
  } catch {
    // Only a speed-up: the live list still works without it.
  }
}
