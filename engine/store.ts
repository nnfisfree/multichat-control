import { DEFAULT_SETTINGS, type Settings } from '../shared/types'
import { core } from './core'

/**
 * The settings, kept in user-data/settings.json exactly as the Electron version kept them, so
 * people updating keep everything. They are read once at start (loadStore), then kept in memory
 * and written back on each change. Logins are not here: they live in the Rust core.
 */
export const store = {
  settings: { ...DEFAULT_SETTINGS } as Settings,
  saveSettings(patch: Partial<Settings>): Settings {
    this.settings = { ...this.settings, ...patch }
    void core.writeFile('settings.json', JSON.stringify(this.settings, null, 2)).catch(() => {})
    return this.settings
  }
}

export async function loadStore(): Promise<void> {
  try {
    const text = await core.readFile('settings.json')
    if (text) store.settings = { ...DEFAULT_SETTINGS, ...JSON.parse(text) }
  } catch {
    // A damaged file starts from the defaults; it is replaced on the next change.
  }
}
