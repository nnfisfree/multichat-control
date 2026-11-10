import { parseText } from '../../../shared/parts'
import type { ChatMessage, StreamEvent } from '../../../shared/types'

export interface YtResult {
  message?: ChatMessage
  event?: StreamEvent
  deleted?: string
  purgedUser?: string
  ended?: boolean
}

/** gRPC enums arrive as TEXT_MESSAGE_EVENT; REST uses textMessageEvent. Both map to the latter. */
export function canonicalType(t: unknown): string {
  const s = String(t ?? '')
  if (!s.includes('_')) return s
  return s.toLowerCase().replace(/_([a-z])/g, (_, c: string) => c.toUpperCase())
}

export function normalize(item: any): YtResult {
  const s = item.snippet ?? {}
  const a = item.authorDetails ?? {}
  const ts = Date.parse(s.publishedAt) || Date.now()
  const type = canonicalType(s.type)
  const name: string = a.displayName ?? 'Unknown'
  const author: ChatMessage['author'] = {
    id: a.channelId ?? s.authorChannelId ?? '',
    name,
    color: a.isChatOwner ? '#ffd24a' : a.isChatModerator ? '#6ea8ff' : a.isChatSponsor ? '#2bd97c' : undefined,
    badges: [
      ...(a.isChatOwner ? [{ id: 'owner', title: 'Owner' }] : []),
      ...(a.isChatModerator ? [{ id: 'mod', title: 'Moderator' }] : []),
      ...(a.isChatSponsor ? [{ id: 'member', title: 'Member' }] : [])
    ],
    isBroadcaster: !!a.isChatOwner,
    isMod: !!a.isChatModerator,
    isMember: !!a.isChatSponsor
  }
  const msg = (text: string, over: Partial<ChatMessage> = {}): ChatMessage => ({
    id: item.id, platform: 'youtube', ts, author, kind: 'chat', parts: parseText(text), ...over
  })
  const ev = (over: Pick<StreamEvent, 'type' | 'text'> & Partial<StreamEvent>): StreamEvent => ({
    id: `ev-${item.id}`, platform: 'youtube', ts, actor: name, details: {}, ...over
  })

  switch (type) {
    case 'textMessageEvent':
      return { message: msg(s.textMessageDetails?.messageText ?? s.displayMessage ?? '') }
    case 'superChatEvent': {
      const d = s.superChatDetails ?? {}
      return {
        message: msg(d.userComment ?? '', { kind: 'paid', label: d.amountDisplayString }),
        event: ev({ type: 'paid', noChat: true, text: 'sent a Super Chat', amount: d.amountDisplayString, message: d.userComment, details: { Tier: String(d.tier ?? ''), Currency: d.currency ?? '' } })
      }
    }
    case 'superStickerEvent': {
      const d = s.superStickerDetails ?? {}
      return { event: ev({ type: 'paid', text: 'sent a Super Sticker', amount: d.amountDisplayString, details: { Tier: String(d.tier ?? ''), Currency: d.currency ?? '' } }) }
    }
    case 'newSponsorEvent': {
      const d = s.newSponsorDetails ?? {}
      return { event: ev({ type: 'sub', text: d.isUpgrade ? 'upgraded their membership' : 'became a member', details: { Level: d.memberLevelName ?? '' } }) }
    }
    case 'memberMilestoneChatEvent': {
      const d = s.memberMilestoneChatDetails ?? {}
      return {
        message: d.userComment ? msg(d.userComment, { kind: 'paid', label: `${d.memberMonth} months` }) : undefined,
        event: ev({ type: 'sub', noChat: !!d.userComment, text: 'hit a membership milestone', amount: `${d.memberMonth} months`, message: d.userComment, details: { Level: d.memberLevelName ?? '' } })
      }
    }
    case 'membershipGiftingEvent': {
      const d = s.membershipGiftingDetails ?? {}
      return { event: ev({ type: 'gift', big: d.giftMembershipsCount >= 5, text: `gifted ${d.giftMembershipsCount} memberships`, amount: String(d.giftMembershipsCount), details: { Level: d.giftMembershipsLevelName ?? '' } }) }
    }
    case 'giftMembershipReceivedEvent':
      return { event: ev({ type: 'gift', noChat: true, text: 'received a gift membership', details: { Level: s.giftMembershipReceivedDetails?.memberLevelName ?? '' } }) }
    case 'messageDeletedEvent':
      return { deleted: s.messageDeletedDetails?.deletedMessageId }
    case 'tombstone':
      return { deleted: item.id }
    case 'userBannedEvent': {
      const d = s.userBannedDetails ?? {}
      const banned = d.bannedUserDetails ?? {}
      const temporary = canonicalType(d.banType).toLowerCase() === 'temporary'
      return {
        purgedUser: banned.channelId,
        event: ev({ type: 'moderation', text: `${temporary ? 'timed out' : 'banned'} ${banned.displayName ?? 'a user'}`, amount: temporary ? `${d.banDurationSeconds}s` : undefined })
      }
    }
    case 'chatEndedEvent':
      return { ended: true, event: ev({ type: 'stream', actor: undefined, text: 'YouTube live chat ended' }) }
    default:
      return {}
  }
}
