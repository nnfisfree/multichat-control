import { ANIMATION_KINDS, DEFAULT_ANIMATIONS, DEFAULT_SETTINGS, animationPref, type Settings } from '../../shared/types'

export type Category = 'connections' | 'appearance' | 'chat' | 'events' | 'app' | 'about'

/**
 * What the Settings search can find: one entry per setting (or group of them), the page it's on and
 * the section to jump to. `words` are extra terms people might type that aren't in the title.
 * Keep it in step with the pages when a setting is added, moved or renamed.
 */
export interface SearchEntry { title: string; desc: string; cat: Category; target: string; words?: string }

export const SEARCH_INDEX: SearchEntry[] = [
  { title: 'Twitch, YouTube and Kick', desc: 'Log in, log out or reconnect your platforms', cat: 'connections', target: 'accounts-settings', words: 'account login logout reconnect google client id secret developer app' },
  { title: 'TikTok', desc: 'Read-only TikTok LIVE chat and gifts, with your Euler Stream key', cat: 'connections', target: 'tiktok-settings', words: 'euler key username live' },
  { title: 'Alerts & Donations', desc: 'StreamElements or Streamlabs: tips and past subs, gifts and Bits', cat: 'connections', target: 'alerts-settings', words: 'streamelements streamlabs donation tip alert' },
  { title: 'Buy Me a Coffee', desc: 'Tips, memberships and shop sales, with your token', cat: 'connections', target: 'bmc-settings', words: 'bmc token coffee membership' },
  { title: 'Streaming App', desc: 'Stream stats from OBS Studio, Streamlabs Desktop or Meld Studio', cat: 'connections', target: 'obs-settings', words: 'obs slobs meld websocket port password bitrate dropped frames fps cpu stream stats' },
  { title: 'Streamer.bot', desc: 'Run your Streamer.bot actions from the message box', cat: 'connections', target: 'streamerbot-settings', words: 'sb actions commands websocket' },

  { title: 'Skins', desc: 'The colours of the whole app', cat: 'appearance', target: 'skins-settings', words: 'theme colour color dark light christmas xmas frosty snow' },
  { title: 'Animate Skin', desc: 'Snow and twinkling lights for skins that have them', cat: 'appearance', target: 'skins-settings', words: 'animation snow lights christmas xmas effects' },
  { title: 'Window Opacity', desc: 'See through the whole window', cat: 'appearance', target: 'window-settings', words: 'transparent transparency' },
  { title: 'Wobbly Window', desc: 'The window bends like jelly while you drag it', cat: 'appearance', target: 'window-settings', words: 'wobble intensity jelly' },
  { title: 'Animated Connection Line', desc: 'The glowing line under the tabs', cat: 'appearance', target: 'window-settings', words: 'glow comet' },
  { title: 'Fonts and Text Size', desc: 'Interface font, chat font and chat text size', cat: 'appearance', target: 'text-settings', words: 'font size scale bigger smaller' },

  { title: 'Show Timestamps', desc: 'The time beside each message', cat: 'chat', target: 'messages-settings', words: 'time clock' },
  { title: 'Keep Chat History', desc: 'Chat from your last 5 streams, on this PC', cat: 'chat', target: 'messages-settings', words: 'clearhistory saved' },
  { title: 'Link Previews', desc: 'A card under video and clip links', cat: 'chat', target: 'messages-settings', words: 'youtube clip' },
  { title: 'Spam Warnings', desc: 'Marks messages selling followers or viewers', cat: 'chat', target: 'messages-settings', words: 'bot ban delete' },
  { title: 'Platforms', desc: 'Username colours, pronouns, GIFs and which events show where', cat: 'chat', target: 'platform-settings', words: 'colour color name role mod vip pronouns gif events subs follows' },
  { title: 'Ignored and Highlighted', desc: 'People whose messages are hidden or stand out', cat: 'chat', target: 'people-settings', words: 'ignore highlight block' },
  { title: 'Emotes', desc: 'BetterTTV, 7TV and FrankerFaceZ', cat: 'chat', target: 'emote-settings', words: 'bttv 7tv ffz' },

  { title: 'Event Pop-ups', desc: 'New events rise above the message box', cat: 'events', target: 'popup-settings', words: 'popup duration seconds' },
  { title: 'Animations', desc: 'Confetti, Bits, gift boxes and banknotes over chat', cat: 'events', target: 'animation-settings', words: 'confetti follow cheer bits gift bomb tip celebration rain' },
  { title: 'Tips and TikTok', desc: 'Cards in chat for tips and for TikTok LIVE', cat: 'events', target: 'other-events-settings', words: 'donation tiktok gifts follows subs' },

  { title: 'When Closing the Window', desc: 'Exit, ask, or keep chat connected in the tray', cat: 'app', target: 'closing-settings', words: 'tray minimize exit quit' },
  { title: 'Welcome Card', desc: 'The card in chat with a Log in button per platform', cat: 'app', target: 'welcome-settings', words: 'setup' },
  { title: 'Confirm Big Actions', desc: 'Ask before an ad, raid or chat clear', cat: 'app', target: 'safety-settings', words: 'safety confirm ad raid clear' },
  { title: 'Clock and Channel Stats', desc: 'The clock under the message box, the stats in the title bar', cat: 'app', target: 'stats-settings', words: 'followers subscribers time' },
  { title: 'Updates', desc: 'Check for new versions, test versions', cat: 'app', target: 'updates-settings', words: 'version update pre-release beta github' },

  { title: 'My Story', desc: 'Who made the app, and why', cat: 'about', target: 'story', words: 'about author' },
  { title: 'Free & Open', desc: 'Free, open source, privacy first', cat: 'about', target: 'free', words: 'privacy open source' },
  { title: 'Support', desc: 'Wall of Supporters, GitHub Sponsors and Buy Me a Coffee', cat: 'about', target: 'support', words: 'sponsor donate supporters collaborators' },
  { title: 'In Memory', desc: 'The dedication', cat: 'about', target: 'memory' }
]

/** Entries matching every word typed, best matches (title hits) first. */
export function searchSettings(query: string): SearchEntry[] {
  const words = query.toLowerCase().split(/\s+/).filter(Boolean)
  if (!words.length) return []
  const scored: [SearchEntry, number][] = []
  for (const e of SEARCH_INDEX) {
    const title = e.title.toLowerCase()
    const all = `${title} ${e.desc.toLowerCase()} ${e.words ?? ''}`
    if (!words.every((w) => all.includes(w))) continue
    scored.push([e, words.filter((w) => title.includes(w)).length])
  }
  return scored.sort((a, b) => b[1] - a[1]).map(([e]) => e)
}

/** Settings each page owns, for the "changed from the defaults" count on its tab. */
const PAGE_KEYS: Partial<Record<Category, (keyof Settings)[]>> = {
  appearance: ['theme', 'skinEffects', 'windowOpacity', 'windowWobble', 'wobbleIntensity', 'connectionLine', 'uiFont', 'chatFont', 'fontScale'],
  chat: ['showTimestamps', 'keepChatHistory', 'linkPreviews', 'spamWarnings', 'showPronouns', 'emoteProviders'],
  events: ['eventPopups', 'eventPopupSeconds', 'animations'],
  app: ['closeAction', 'confirmActions', 'showClock', 'showStats', 'autoUpdate', 'updatePrereleases']
}

// key order can differ between saved files and the defaults, so compare sorted
const same = (a: unknown, b: unknown): boolean => {
  if (a === b) return true
  if (!a || !b || typeof a !== 'object' || typeof b !== 'object') return false
  const ka = Object.keys(a).sort()
  const kb = Object.keys(b).sort()
  return ka.length === kb.length && ka.every((k, i) => k === kb[i] && same((a as any)[k], (b as any)[k]))
}

/** How many of a page's settings differ from a fresh install. A missing value counts as the default. */
export function changedCount(s: Settings, cat: Category): number {
  return (PAGE_KEYS[cat] ?? []).filter((k) => {
    if (s[k] === undefined) return false
    // older files miss the newer animation kinds; those count as their defaults
    if (k === 'animations') return ANIMATION_KINDS.some((kind) => !same(animationPref(s, kind), DEFAULT_ANIMATIONS[kind]))
    return !same(s[k], DEFAULT_SETTINGS[k])
  }).length
}
