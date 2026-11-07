import type { Emote } from '../../../shared/types'
import type { Helix } from './connector'

export const MY_CHANNEL_GROUP = 'My Channel Emotes'

export interface Owner { name: string; avatar: string }

/** Avatars show at 20px, so the small size loads much faster than the 300px default. */
export const smallAvatar = (url: string | undefined): string => (url ?? '').replace('300x300', '70x70')

const toEmote = (e: any, group: string, groupIcon?: string): Emote => ({
  id: e.id,
  name: e.name,
  url: `https://static-cdn.jtvnw.net/emoticons/v2/${e.id}/${e.format?.includes('animated') ? 'default' : 'static'}/dark/2.0`,
  provider: 'twitch',
  platform: 'twitch',
  group,
  groupIcon,
  animated: e.format?.includes('animated')
})

/** Orders emotes: your channel, then each channel you're subscribed to by name, then the rest. */
export function buildEmoteList(self: { id: string; avatar: string }, channel: any[], user: any[], global: any[], owners: ReadonlyMap<string, Owner>): Emote[] {
  const mine: Emote[] = channel.map((e) => toEmote(e, MY_CHANNEL_GROUP, self.avatar))
  const byChannel = new Map<string, Emote[]>()
  const other: Emote[] = []
  for (const e of user) {
    const owner = owners.get(e.owner_id)
    if (e.owner_id === self.id) mine.push(toEmote(e, MY_CHANNEL_GROUP, self.avatar))
    else if (owner) {
      if (!byChannel.has(owner.name)) byChannel.set(owner.name, [])
      byChannel.get(owner.name)!.push(toEmote(e, `${owner.name} Emotes`, owner.avatar))
    } else other.push(toEmote(e, 'Other Emotes'))
  }
  const channels = [...byChannel.keys()].sort((a, b) => a.localeCompare(b)).flatMap((name) => byChannel.get(name)!)
  const seen = new Set<string>()
  return [...mine, ...channels, ...other, ...global.map((e) => toEmote(e, 'Twitch Global'))]
    .filter((e) => !seen.has(e.name) && !!seen.add(e.name))
}

/** Twitch accepts 100 IDs per request, so large emote collections take several calls at once. */
export async function fetchOwners(helix: Helix, ids: string[]): Promise<Map<string, Owner>> {
  const unique = [...new Set(ids.filter((id) => /^[1-9]\d*$/.test(id)))]
  const pages: string[][] = []
  for (let i = 0; i < unique.length; i += 100) pages.push(unique.slice(i, i + 100))
  const results = await Promise.all(pages.map(async (page) => {
    const url = new URLSearchParams(page.map((id) => ['id', id]))
    return helix('GET', `/users?${url}`).catch(() => null)
  }))
  const owners = new Map<string, Owner>()
  for (const r of results) for (const u of r?.data ?? []) owners.set(u.id, { name: u.display_name, avatar: smallAvatar(u.profile_image_url) })
  return owners
}
