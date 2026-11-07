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
    return [{ id: e.id, name: e.name, url: `https:${host}/2x.webp`, provider: '7tv', platform, group, animated: !!e.data?.animated }]
  })
}

export async function load7tv(service: Service, userId: string | undefined, platform: Platform): Promise<Emote[]> {
  const [global, user] = await Promise.all([
    quiet(fetchJson('https://7tv.io/v3/emote-sets/global'), null),
    userId ? quiet(fetchJson(`https://7tv.io/v3/users/${service}/${encodeURIComponent(userId)}`), null) : null
  ])
  return [...from7tv(user?.emote_set?.emotes, platform, '7TV Channel'), ...from7tv(global?.emotes, platform, '7TV Global')]
}

const fromBttv = (list: any[], group: string): Emote[] => (list ?? []).map((e: any) => ({
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
  Object.values(sets ?? {}).flatMap((s: any) => (s.emoticons ?? []).filter((e: any) => !e.hidden).map((e: any): Emote => {
    const url: string = e.urls?.['2'] ?? e.urls?.['1']
    return { id: String(e.id), name: e.name, url: url.startsWith('//') ? `https:${url}` : url, provider: 'ffz', platform: 'twitch', group }
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

export function toLookup(emotes: Emote[]): Map<string, { name: string; url: string }> {
  // Reverse order, so higher-priority sets win when two share a name.
  const map = new Map<string, { name: string; url: string }>()
  for (const e of [...emotes].reverse()) if (e.url) map.set(e.name, { name: e.name, url: e.url })
  return map
}
