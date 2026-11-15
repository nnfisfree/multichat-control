import type { RaidInfo } from '../../../shared/types'
import type { Helix } from './connector'

// Twitch sends the raid by itself 90s after it's started
export const RAID_COUNTDOWN_MS = 90_000

/**
 * Starts the raid and collects what the raid bar shows: avatar, game, viewers and title. If a
 * lookup fails the raid still goes ahead, there's just less to show.
 */
export async function startRaid(helix: Helix, me: string, login: string): Promise<RaidInfo> {
  const clean = login.trim().replace(/^@/, '').toLowerCase()
  if (!clean) throw new Error('Add a channel name, like /raid username.')
  const u = (await helix('GET', '/users', { login: clean }))?.data?.[0]
  if (!u) throw new Error(`Twitch has no channel called "${clean}".`)
  const r = await helix('POST', '/raids', { from_broadcaster_id: me, to_broadcaster_id: u.id })
  const startedAt = Date.parse(r?.data?.[0]?.created_at ?? '') || Date.now()
  const s = (await helix('GET', '/streams', { user_id: u.id }).catch(() => null))?.data?.[0]
  let game: string | undefined = s?.game_name || undefined
  // offline channels still have a category set, show it as what they last streamed
  if (!s) game = (await helix('GET', '/channels', { broadcaster_id: u.id }).catch(() => null))?.data?.[0]?.game_name || undefined
  return {
    login: u.login, name: u.display_name || u.login, avatar: u.profile_image_url || undefined,
    game, title: s?.title || undefined, viewers: s ? Number(s.viewer_count) || 0 : undefined, live: !!s,
    startedAt, endsAt: startedAt + RAID_COUNTDOWN_MS
  }
}
