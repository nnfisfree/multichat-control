import type { ChatMessage, Platform } from '../../shared/types'
import { getState, updateSettings } from './store'

export type UserMark = 'ignoredUsers' | 'highlightedUsers'

/** Key for a chatter in the ignore / highlight lists. Ids stay the same when someone renames. */
export const userKey = (platform: Platform, id: string): string => `${platform}:${id}`

/** Adds or removes a chatter from one of the lists, returns whether they're on it now. */
export function toggleUserMark(list: UserMark, m: Pick<ChatMessage, 'platform' | 'author'>): boolean {
  const current = getState().settings?.[list] ?? {}
  const key = userKey(m.platform, m.author.id)
  const next = { ...current }
  const on = !(key in next)
  if (on) next[key] = m.author.name
  else delete next[key]
  void updateSettings({ [list]: next })
  return on
}

/** Twitch's own popout viewer card for a chatter in the streamer's channel. */
export const twitchViewerCardUrl = (channel: string, login: string): string =>
  `https://www.twitch.tv/popout/${encodeURIComponent(channel.toLowerCase())}/viewercard/${encodeURIComponent(login.toLowerCase())}`
