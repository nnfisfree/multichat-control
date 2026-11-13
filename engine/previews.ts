import { previewTarget, type PreviewTarget } from '../shared/parts'
import type { LinkPreview, Platform, StreamEvent } from '../shared/types'
import { log } from './log'
import { fetchJson, message } from './net'
import { fetchKickClip } from './platforms/kick/discovery'
import { store } from './store'

const num = (v: unknown): number | undefined => {
  const n = Number(v)
  return Number.isFinite(n) && n > 0 ? n : undefined
}

/** A clip from Twitch's API (Get Clips) as a card. */
export function twitchClipPreview(c: any): LinkPreview | null {
  if (!c?.id) return null
  return {
    url: typeof c.url === 'string' && c.url.startsWith('https://') ? c.url : `https://clips.twitch.tv/${c.id}`,
    platform: 'twitch', kind: 'clip', title: String(c.title || 'Untitled clip'),
    channel: c.broadcaster_name || undefined, clippedBy: c.creator_name || undefined,
    thumbnail: c.thumbnail_url || undefined, seconds: num(c.duration), views: num(c.view_count)
  }
}

/** A clip from the data Kick's website uses, as a card. */
export function kickClipPreview(c: any): LinkPreview | null {
  if (!c?.id) return null
  const slug = /^[\w-]+$/.test(c.channel?.slug ?? '') ? c.channel.slug : ''
  return {
    url: slug ? `https://kick.com/${slug}/clips/${c.id}` : `https://kick.com/clips/${c.id}`,
    platform: 'kick', kind: 'clip', title: String(c.title || 'Untitled clip'),
    channel: c.channel?.username || undefined, clippedBy: c.creator?.username || undefined,
    thumbnail: c.thumbnail_url || undefined, seconds: num(c.duration), views: num(c.view_count ?? c.views)
  }
}

/** YouTube's public oEmbed: title, channel and picture, with no login and no API quota. */
async function youtube(t: Extract<PreviewTarget, { kind: 'youtube' | 'youtube-clip' }>, link: string): Promise<LinkPreview | null> {
  const page = t.kind === 'youtube-clip' ? link : `https://www.youtube.com/watch?v=${t.id}`
  const d = await fetchJson(`https://www.youtube.com/oembed?format=json&url=${encodeURIComponent(page)}`)
  if (!d?.title) return null
  const short = t.kind === 'youtube' && t.short
  return {
    url: t.kind === 'youtube-clip' ? link : short ? `https://www.youtube.com/shorts/${t.id}` : page,
    platform: 'youtube', kind: t.kind === 'youtube-clip' ? 'clip' : short ? 'short' : 'video',
    title: String(d.title), channel: d.author_name || undefined,
    // The 16:9 picture; oEmbed's own one has black bars.
    thumbnail: t.kind === 'youtube' ? `https://i.ytimg.com/vi/${t.id}/mqdefault.jpg` : d.thumbnail_url || undefined
  }
}

const MAX_CACHED = 500
/** A failed lookup is tried again after this long, such as after logging in to Twitch. */
const RETRY_MS = 5 * 60 * 1000

/**
 * Looks up the cards for links in chat. Each video or clip is looked up once, however many
 * messages link it, and the answers are kept for the session.
 */
export class Previews {
  private cache = new Map<string, Promise<LinkPreview | null>>()

  constructor(private twitchClip: (id: string) => Promise<LinkPreview | null>, private demo?: (t: PreviewTarget) => LinkPreview | null) {}

  get(url: string): Promise<LinkPreview | null> {
    const t = store.settings.linkPreviews ? previewTarget(url) : null
    if (!t) return Promise.resolve(null)
    const key = `${t.kind}:${t.id}`
    const hit = this.cache.get(key)
    if (hit) return hit
    const p = this.load(t, url).catch((err) => {
      log('previews', `${t.kind} lookup failed: ${message(err)}`)
      return null
    })
    this.cache.set(key, p)
    void p.then((r) => { if (!r) setTimeout(() => this.cache.delete(key), RETRY_MS) })
    if (this.cache.size > MAX_CACHED) this.cache.delete(this.cache.keys().next().value!)
    return p
  }

  private async load(t: PreviewTarget, url: string): Promise<LinkPreview | null> {
    if (this.demo) return this.demo(t)
    switch (t.kind) {
      case 'youtube':
      case 'youtube-clip':
        return youtube(t, url)
      case 'twitch-clip':
        return this.twitchClip(t.id)
      case 'kick-clip':
        return kickClipPreview(await fetchKickClip(t.id))
    }
  }
}

export interface NewClip { id: string; createdAt: number; preview: LinkPreview }

const CLIP_CHECK_MS = 60000
/** Clips made this long before the app connected still count, to allow for clocks that differ. */
const CLOCK_SLACK_MS = 2 * 60 * 1000

/**
 * Notices new clips of the streamer's channel, by whoever made them, and reports each one once
 * as a 'clip' event. Neither Twitch nor Kick announces clips, so the list is checked regularly.
 */
export class ClipWatch {
  private timer: ReturnType<typeof setInterval> | null = null
  private since = 0
  private seen = new Set<string>()
  private failures = 0
  private skip = 0

  constructor(
    private platform: Platform,
    private list: (since: number) => Promise<NewClip[]>,
    private event: (e: StreamEvent) => void,
    private every = CLIP_CHECK_MS
  ) {}

  start(): void {
    this.stop()
    this.since = Date.now()
    this.failures = 0
    this.skip = 0
    this.timer = setInterval(() => void this.check(), this.every)
  }

  stop(): void {
    if (this.timer) clearInterval(this.timer)
    this.timer = null
  }

  /** Checks now: also used shortly after the streamer makes a clip from the app. */
  async check(force = false): Promise<void> {
    if (!this.timer) return
    // After failures, checks thin out to one every 2, 4, 8 and at most 16 minutes.
    if (!force && this.skip > 0) {
      this.skip--
      return
    }
    let clips: NewClip[]
    try {
      clips = await this.list(this.since - CLOCK_SLACK_MS)
      this.failures = 0
    } catch (err) {
      this.failures++
      this.skip = Math.min(16, 2 ** this.failures) - 1
      if (this.failures === 3) log(this.platform, `clip check keeps failing: ${message(err)}`)
      return
    }
    for (const c of [...clips].sort((a, b) => a.createdAt - b.createdAt)) {
      if (this.seen.has(c.id) || !(c.createdAt >= this.since - CLOCK_SLACK_MS)) continue
      this.seen.add(c.id)
      this.event({
        id: `${this.platform}-clip-${c.id}`, platform: this.platform, ts: Date.now(), type: 'clip',
        actor: c.preview.clippedBy, text: c.preview.clippedBy ? 'made a clip' : 'New clip', preview: c.preview, details: {}
      })
    }
  }
}
