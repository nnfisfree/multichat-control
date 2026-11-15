import type { Emote } from '../../shared/types'
import { core } from '../core'

const file = (key: string): string => `emote-cache/${key.replace(/[^\w-]/g, '_')}.json`

/** Last session's list, so the picker opens instantly while a fresh copy loads. */
export async function loadEmoteCache(key: string): Promise<Emote[] | null> {
  try {
    const text = await core.readFile(file(key))
    const list = text ? JSON.parse(text) : null
    return Array.isArray(list) && list.length ? list : null
  } catch {
    return null
  }
}

export function saveEmoteCache(key: string, list: Emote[]): void {
  // just a speed-up, the live list works without it
  void core.writeFile(file(key), JSON.stringify(list)).catch(() => {})
}
