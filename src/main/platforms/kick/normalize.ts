import { parseKickContent } from '../../../shared/parts'
import type { EmoteLookup } from '../../../shared/parts'
import type { ChatMessage, StreamEvent } from '../../../shared/types'

export interface KickResult {
  message?: ChatMessage
  event?: StreamEvent
  deleted?: string
  purgedUser?: string
  purgedAll?: boolean
}

const BADGE_TITLE: Record<string, string> = {
  broadcaster: 'Broadcaster', moderator: 'Moderator', vip: 'VIP', og: 'OG', founder: 'Founder', verified: 'Verified', subscriber: 'Subscriber', sub_gifter: 'Gifter', staff: 'Staff'
}

const clean = (name: string): string => name.replace(/^App\\Events\\/, '').replace(/^.*\\/, '')

let eventSeq = 0
const ev = (over: Omit<StreamEvent, 'id' | 'platform' | 'ts' | 'details'> & { details?: Record<string, string> }): StreamEvent => ({
  id: `kick-${Date.now()}-${++eventSeq}`, platform: 'kick', ts: Date.now(), details: {}, ...over
})

/** Normalizes one socket event. These payloads are unofficial, so every field is treated as optional. */
export function normalize(rawName: string, d: any, third: EmoteLookup): KickResult {
  const name = clean(rawName)
  switch (name) {
    case 'ChatMessageEvent': {
      if (!d?.id || !d.sender) return {}
      const badges = d.sender.identity?.badges ?? []
      const has = (t: string): boolean => badges.some((b: any) => b.type === t)
      return {
        message: {
          id: d.id, platform: 'kick', ts: Date.parse(d.created_at) || Date.now(), kind: 'chat',
          author: {
            id: String(d.sender.id), name: d.sender.username, login: d.sender.slug, color: d.sender.identity?.color,
            badges: [
              ...badges.map((b: any) => ({ id: b.type, title: BADGE_TITLE[b.type] ?? b.text ?? b.type })),
              ...(d.sender.identity?.badges_v2 ?? []).filter((b: any) => b.selected && b.image_url).map((b: any) => ({ id: b.name, title: b.name, url: b.image_url }))
            ],
            isBroadcaster: has('broadcaster'), isMod: has('moderator'), isVip: has('vip')
          },
          parts: parseKickContent(d.content ?? '', third),
          reply: d.type === 'reply' && d.metadata?.original_sender
            ? { author: d.metadata.original_sender.username, text: d.metadata.original_message?.content ?? '' } : undefined
        }
      }
    }
    case 'MessageDeletedEvent':
      return { deleted: d?.message?.id }
    case 'ChatroomClearEvent':
      return { purgedAll: true }
    case 'UserBannedEvent': {
      const temp = d?.permanent === false || !!d?.expires_at
      return {
        purgedUser: d?.user?.id != null ? String(d.user.id) : undefined,
        event: ev({ type: 'moderation', actor: d?.banned_by?.username, text: `${temp ? 'timed out' : 'banned'} ${d?.user?.username ?? 'a user'}`, amount: temp && d?.duration ? `${d.duration}m` : undefined })
      }
    }
    case 'UserUnbannedEvent':
      return { event: ev({ type: 'moderation', actor: d?.unbanned_by?.username, text: `unbanned ${d?.user?.username ?? 'a user'}` }) }
    case 'SubscriptionEvent':
      return { event: ev({ type: 'sub', actor: d?.username ?? d?.usernames?.[0], text: 'subscribed', amount: d?.months ? `${d.months} months` : undefined }) }
    case 'GiftedSubscriptionsEvent': {
      const list: string[] = d?.gifted_usernames ?? []
      return { event: ev({ type: 'gift', big: list.length >= 5, actor: d?.gifter_username, text: `gifted ${list.length} sub${list.length === 1 ? '' : 's'}`, amount: String(list.length), details: { Recipients: list.join(', '), 'Total gifted': String(d?.gifter_total ?? '') } }) }
    }
    case 'StreamHostEvent':
      return { event: ev({ type: 'raid', big: true, actor: d?.host_username, text: `hosted with ${d?.number_viewers} viewers`, amount: String(d?.number_viewers ?? ''), message: d?.optional_message || undefined }) }
    case 'FollowersUpdated':
      return d?.followed && d?.username ? { event: ev({ type: 'follow', actor: d.username, text: 'followed' }) } : {}
    case 'RewardRedeemedEvent':
      return { event: ev({ type: 'redemption', actor: d?.username, text: 'redeemed', subject: d?.reward_title ?? 'a reward', amount: d?.reward_cost != null ? String(d.reward_cost) : undefined, message: d?.user_input || undefined, details: { Reward: d?.reward_title ?? '' } }) }
    case 'KicksGifted':
      return { event: ev({ type: 'paid', actor: d?.sender?.username, text: 'sent KICKs', amount: String(d?.gift?.amount ?? ''), message: d?.message || undefined }) }
    case 'StreamerIsLive':
      return { event: ev({ type: 'stream', text: 'Stream went live' }) }
    case 'StopStreamBroadcast':
      return { event: ev({ type: 'stream', text: 'Stream went offline' }) }
    default:
      return {}
  }
}
