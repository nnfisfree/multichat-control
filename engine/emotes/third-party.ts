import type { Emote, EmoteProviders, Platform } from '../../shared/types'
import { fetchJson } from '../net'

type Service = 'twitch' | 'kick'

const quiet = async <T,>(p: Promise<T>, fallback: T): Promise<T> => {
  try {
    return await p
  } catch {
    return fallback
  }
}

function from7tv(list: any[], platform: Platform, group: string): Emote[] {
  return (list ?? []).flatMap((e: any): Emote[] => {
    const host = e.data?.host?.url
    if (!host) return []
    // Flag 1 on the set entry (or 256 on the emote) marks an emote meant to sit on top of the previous one.
    const zeroWidth = !!((e.flags ?? 0) & 1) || !!((e.data?.flags ?? 0) & 256)
    return [{ id: e.id, name: e.name, url: `https:${host}/2x.webp`, provider: '7tv', platform, group, animated: !!e.data?.animated, zeroWidth }]
  })
}

export async function load7tv(service: Service, userId: string | undefined, platform: Platform): Promise<Emote[]> {
  const [global, user] = await Promise.all([
    quiet(fetchJson('https://7tv.io/v3/emote-sets/global'), null),
    userId ? quiet(fetchJson(`https://7tv.io/v3/users/${service}/${encodeURIComponent(userId)}`), null) : null
  ])
  return [...from7tv(user?.emote_set?.emotes, platform, '7TV Channel'), ...from7tv(global?.emotes, platform, '7TV Global')]
}

// Modifiers such as h! (flip) change the next emote rather than being emotes, so they stay text.
const fromBttv = (list: any[], group: string): Emote[] => (list ?? []).filter((e: any) => !e.modifier).map((e: any) => ({
  id: e.id, name: e.code, url: `https://cdn.betterttv.net/emote/${e.id}/2x`, provider: 'bttv', platform: 'twitch', group, animated: !!e.animated
}))

async function loadBttv(userId: string | undefined): Promise<Emote[]> {
  const [global, user] = await Promise.all([
    quiet(fetchJson('https://api.betterttv.net/3/cached/emotes/global'), []),
    userId ? quiet(fetchJson(`https://api.betterttv.net/3/cached/users/twitch/${userId}`), null) : null
  ])
  return [...fromBttv([...(user?.channelEmotes ?? []), ...(user?.sharedEmotes ?? [])], 'BetterTTV Channel'), ...fromBttv(global, 'BetterTTV Global')]
}

const fromFfz = (sets: Record<string, any> | undefined, group: string): Emote[] =>
  Object.values(sets ?? {}).flatMap((s: any) => (s.emoticons ?? []).filter((e: any) => !e.hidden && !e.modifier).flatMap((e: any): Emote[] => {
    // Animated emotes have their own links; a missing link skips the emote rather than failing all.
    const url: string | undefined = e.animated?.['2'] ?? e.animated?.['1'] ?? e.urls?.['2'] ?? e.urls?.['1']
    if (!url) return []
    return [{ id: String(e.id), name: e.name, url: url.startsWith('//') ? `https:${url}` : url, provider: 'ffz', platform: 'twitch', group, animated: !!e.animated }]
  }))

async function loadFfz(userId: string | undefined): Promise<Emote[]> {
  const [global, room] = await Promise.all([
    quiet(fetchJson('https://api.frankerfacez.com/v1/set/global'), null),
    userId ? quiet(fetchJson(`https://api.frankerfacez.com/v1/room/id/${userId}`), null) : null
  ])
  return [...fromFfz(room?.sets, 'FrankerFaceZ Channel'), ...fromFfz(global?.sets, 'FrankerFaceZ Global')]
}

/** Loads the extra sets the user has enabled. */
export async function loadTwitchExtras(userId: string | undefined, on: EmoteProviders): Promise<Emote[]> {
  const [seven, bttv, ffz] = await Promise.all([
    on.seventv ? load7tv('twitch', userId, 'twitch') : [],
    on.bttv ? loadBttv(userId) : [],
    on.ffz ? loadFfz(userId) : []
  ])
  return [...seven, ...bttv, ...ffz]
}

export function toLookup(emotes: Emote[]): Map<string, { name: string; url: string; overlay?: boolean }> {
  // Reverse order, so higher-priority sets win when two share a name.
  const map = new Map<string, { name: string; url: string; overlay?: boolean }>()
  for (const e of [...emotes].reverse()) if (e.url) map.set(e.name, { name: e.name, url: e.url, overlay: e.zeroWidth || undefined })
  return map
}
