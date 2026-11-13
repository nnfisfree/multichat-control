import { PLATFORMS, PLATFORM_LABEL, type Emote, type MessagePart, type Platform } from './types'

const URL_RE = /\bhttps?:\/\/[^\s<>"']+/gi

/** Accepts only real web links, so chat cannot smuggle other URL schemes into a click. */
export function safeUrl(raw: string): string | null {
  try {
    const u = new URL(raw)
    return u.protocol === 'http:' || u.protocol === 'https:' ? u.href : null
  } catch {
    return null
  }
}

export function linkify(text: string): MessagePart[] {
  const out: MessagePart[] = []
  let last = 0
  for (const m of text.matchAll(URL_RE)) {
    const raw = m[0].replace(/[.,!?)\]]+$/, '')
    const url = safeUrl(raw)
    if (!url) continue
    const at = m.index
    if (at > last) out.push({ type: 'text', text: text.slice(last, at) })
    out.push({ type: 'link', url, text: raw })
    last = at + raw.length
  }
  if (last < text.length) out.push({ type: 'text', text: text.slice(last) })
  return out
}

/** A link that gets a preview card: a YouTube video, short or clip, or a Twitch or Kick clip. */
export type PreviewTarget =
  | { kind: 'youtube'; id: string; short?: boolean }
  | { kind: 'youtube-clip'; id: string }
  | { kind: 'twitch-clip'; id: string }
  | { kind: 'kick-clip'; id: string }

const YT_ID = /^[\w-]{11}$/
const TWITCH_SLUG = /^[\w-]{3,100}$/
const KICK_CLIP = /^clip_[A-Z0-9]{10,40}$/i

/** Recognises the links that get a preview card, in the shapes the platforms share them. */
export function previewTarget(raw: string): PreviewTarget | null {
  let u: URL
  try {
    u = new URL(raw)
  } catch {
    return null
  }
  if (u.protocol !== 'https:' && u.protocol !== 'http:') return null
  const host = u.hostname.toLowerCase().replace(/^(www|m)\./, '')
  const seg = u.pathname.split('/').filter(Boolean)
  if (host === 'youtu.be') return YT_ID.test(seg[0] ?? '') ? { kind: 'youtube', id: seg[0] } : null
  if (host === 'youtube.com' || host === 'music.youtube.com') {
    const v = u.searchParams.get('v')
    if (seg[0] === 'watch' && v && YT_ID.test(v)) return { kind: 'youtube', id: v }
    if (['shorts', 'live', 'embed', 'v'].includes(seg[0]) && YT_ID.test(seg[1] ?? '')) return { kind: 'youtube', id: seg[1], short: seg[0] === 'shorts' }
    if (seg[0] === 'clip' && /^Ugk[\w-]{20,40}$/.test(seg[1] ?? '')) return { kind: 'youtube-clip', id: seg[1] }
    return null
  }
  if (host === 'clips.twitch.tv') {
    const id = seg[0] === 'embed' ? u.searchParams.get('clip') : seg.length === 1 ? seg[0] : null
    return id && TWITCH_SLUG.test(id) ? { kind: 'twitch-clip', id } : null
  }
  if (host === 'twitch.tv') {
    // twitch.tv/<channel>/clip/<slug>, and the mobile site's twitch.tv/clip/<slug>.
    const at = seg.indexOf('clip')
    return at >= 0 && at <= 1 && TWITCH_SLUG.test(seg[at + 1] ?? '') ? { kind: 'twitch-clip', id: seg[at + 1] } : null
  }
  if (host === 'kick.com') {
    // kick.com/<channel>/clips/<id>, and kick.com/<channel>?clip=<id>.
    const id = seg[1] === 'clips' ? seg[2] : u.searchParams.get('clip')
    return id && KICK_CLIP.test(id) ? { kind: 'kick-clip', id } : null
  }
  return null
}

/** The first link in a message that gets a preview card, as Twitch's own chat shows one per message. */
export function firstPreviewLink(parts: MessagePart[]): string | null {
  for (const p of parts) if (p.type === 'link' && previewTarget(p.url)) return p.url
  return null
}

export type EmoteLookup = ReadonlyMap<string, { name: string; url: string; overlay?: boolean }>

function emoteWords(text: string, emotes: EmoteLookup): MessagePart[] {
  if (!emotes.size) return text ? [{ type: 'text', text }] : []
  const out: MessagePart[] = []
  let buf = ''
  for (const tok of text.split(/(\s+)/)) {
    const hit = emotes.get(tok)
    if (hit) {
      if (buf) out.push({ type: 'text', text: buf })
      buf = ''
      out.push(hit.overlay ? { type: 'emote', name: hit.name, url: hit.url, overlay: true } : { type: 'emote', name: hit.name, url: hit.url })
    } else buf += tok
  }
  if (buf) out.push({ type: 'text', text: buf })
  return out
}

/** Turns plain text into links and named emotes. */
export function parseText(text: string, emotes: EmoteLookup = new Map()): MessagePart[] {
  return linkify(text).flatMap((p) => (p.type === 'text' ? emoteWords(p.text, emotes) : [p]))
}

export function plainText(parts: MessagePart[]): string {
  return parts.map((p) => (p.type === 'emote' ? p.name : p.type === 'gif' ? `[${p.alt}]` : p.text)).join('')
}

/**
 * Formats outgoing text for one platform. Text is sent as typed, except that a word matching
 * a native Kick emote becomes Kick's token. Anything else goes out as its plain name.
 */
export function serializeFor(platform: Platform, text: string, emotes: Pick<Emote, 'id' | 'name' | 'provider'>[]): string {
  if (platform !== 'kick') return text
  const native = new Map(emotes.filter((e) => e.provider === 'kick').map((e) => [e.name, e]))
  return text.split(/(\s+)/).map((w) => {
    const e = native.get(w)
    return e ? `[emote:${e.id}:${e.name}]` : w
  }).join('')
}

/** Reads Kick's `[emote:id:name]` tokens from incoming text. */
export function parseKickContent(content: string, emotes: EmoteLookup = new Map()): MessagePart[] {
  const re = /\[emote:(\d+):([^\]\s]+)\]/g
  const out: MessagePart[] = []
  let last = 0
  for (const m of content.matchAll(re)) {
    if (m.index > last) out.push(...parseText(content.slice(last, m.index), emotes))
    out.push({ type: 'emote', name: m[2], url: `https://files.kick.com/emotes/${m[1]}/fullsize` })
    last = m.index + m[0].length
  }
  if (last < content.length) out.push(...parseText(content.slice(last), emotes))
  return out
}

/** Names exactly where a message will go. */
export function composerPlaceholder(tab: Platform | 'all', destinations: Platform[], anyConnected: boolean): string {
  if (tab !== 'all') return `Send a message to ${PLATFORM_LABEL[tab]}...`
  if (!anyConnected) return 'No platforms connected'
  if (!destinations.length) return 'No platforms selected'
  if (destinations.length === PLATFORMS.length) return 'Send a message to all platforms...'
  return `Send a message to ${destinations.map((p) => PLATFORM_LABEL[p]).join(' and ')}...`
}

/** Picker order: native first on a platform tab; Twitch, third-party, Kick, YouTube on All. */
export function sortEmotes(emotes: Emote[], scope: Platform | 'all'): Emote[] {
  const rank = (e: Emote): number => {
    if (scope !== 'all') return e.provider === 'twitch' || e.provider === 'kick' || e.provider === 'emoji' ? 0 : 1
    if (e.platform === 'twitch') return e.provider === 'twitch' ? 0 : 1
    if (e.platform === 'kick') return e.provider === 'kick' ? 2 : 3
    return 4
  }
  return emotes.map((e, i) => [e, i] as const).sort((a, b) => rank(a[0]) - rank(b[0]) || a[1] - b[1]).map(([e]) => e)
}
