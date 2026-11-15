import { DEFAULT_SETTINGS, type Settings } from '../shared/types'
import { core } from './core'

/**
 * Settings, in user-data/settings.json. Same shape the Electron build used, so upgrading keeps
 * everything. Read once on start (loadStore), then kept in memory and written back on every change.
 * Logins aren't in here, Rust keeps those.
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
    if (!text) return
    const saved = JSON.parse(text)
    // Migration for files from before obsSetUp existed: count OBS as set up if it was ever enabled
    // (it used to default to off) or given a custom port.
    if (!('obsSetUp' in saved)) saved.obsSetUp = saved.obsEnabled === true || (typeof saved.obsPort === 'number' && saved.obsPort !== DEFAULT_SETTINGS.obsPort)
    // Sweet became the default in 0.3.2. A settings file from before skins existed has no theme,
    // and that person has been looking at POS Club all along, so keep it for them.
    if (!('theme' in saved)) saved.theme = 'pos'
    store.settings = { ...DEFAULT_SETTINGS, ...saved }
  } catch {
    // corrupt file: fall back to defaults, it gets overwritten on the next change
  }
}
