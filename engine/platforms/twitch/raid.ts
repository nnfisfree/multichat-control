import type { RaidInfo } from '../../../shared/types'
import type { Helix } from './connector'

/** Twitch sends a raid on its own 90 seconds after it is set up. */
export const RAID_COUNTDOWN_MS = 90_000

/**
 * Starts a raid and gathers what the raid bar shows about the channel: picture, game, viewers
 * and title. A failed lookup still leaves the raid running, just with less to show.
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
  // Offline channels still have a category set; it shows as what they last streamed.
  if (!s) game = (await helix('GET', '/channels', { broadcaster_id: u.id }).catch(() => null))?.data?.[0]?.game_name || undefined
  return {
    login: u.login, name: u.display_name || u.login, avatar: u.profile_image_url || undefined,
    game, title: s?.title || undefined, viewers: s ? Number(s.viewer_count) || 0 : undefined, live: !!s,
    startedAt, endsAt: startedAt + RAID_COUNTDOWN_MS
  }
}
