import { DEFAULT_SETTINGS, type PlatformPrefs, type Settings } from '../shared/types'
import { PLATFORM_EVENTS, PREF_PLATFORMS } from '../shared/event-prefs'
import { chatEventGroup } from '../shared/events'
import { core } from './core'

/**
 * Settings, in user-data/settings.json. Read once on start (loadStore), then kept in memory and
 * written back on every change.
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
    // TikTok arrived in 0.4. These two are nested, so the shallow merge below wouldn't add it.
    if (saved.sendTargets && typeof saved.sendTargets === 'object' && !('tiktok' in saved.sendTargets)) saved.sendTargets.tiktok = false
    const filter = saved.eventFilter?.platforms
    if (filter && typeof filter === 'object' && !('tiktok' in filter)) filter.tiktok = true
    // Per-platform event switches arrived in 0.4.1. Carry over any "Events in chat" switch that was
    // turned off, so Twitch, YouTube and Kick keep hiding what they hid before.
    if (!('platformPrefs' in saved) && saved.chatEvents && typeof saved.chatEvents === 'object') {
      const prefs: Partial<Record<string, PlatformPrefs>> = {}
      for (const p of PREF_PLATFORMS) {
        const events: NonNullable<PlatformPrefs['events']> = {}
        for (const { type } of PLATFORM_EVENTS[p]) {
          const group = chatEventGroup(type)
          if (group && saved.chatEvents[group] === false) events[type] = { chat: false }
        }
        if (Object.keys(events).length) prefs[p] = { events }
      }
      saved.platformPrefs = prefs
    }
    store.settings = { ...DEFAULT_SETTINGS, ...saved }
  } catch {
    // corrupt file: fall back to defaults, it gets overwritten on the next change
  }
}
