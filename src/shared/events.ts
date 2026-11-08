import type { ChatEventGroup, ChatMessage, EventType, StreamEvent } from './types'

/** The short badge shown on the right of each event. */
export const EVENT_BADGE: Record<EventType, string> = {
  redemption: 'CP', sub: 'SUB', gift: 'GIFT', cheer: 'BITS', bits: 'BITS', raid: 'RAID', powerup: 'PWR', follow: 'FLW',
  paid: 'PAID', hypetrain: 'HYPE', poll: 'POLL', prediction: 'PRED', goal: 'GOAL', ad: 'AD', shoutout: 'SO',
  moderation: 'MOD', stream: 'LIVE', announcement: 'ANN', other: 'INFO'
}

/** A finished stream says OFF rather than LIVE. */
export const eventBadge = (e: Pick<StreamEvent, 'type' | 'text'>): string =>
  e.type === 'stream' && /offline|ended/i.test(e.text) ? 'OFF' : EVENT_BADGE[e.type]

const GROUP: Partial<Record<EventType, ChatEventGroup>> = {
  sub: 'subs', gift: 'gifts', cheer: 'cheers', raid: 'raids', redemption: 'redemptions',
  powerup: 'powerups', follow: 'follows', paid: 'paid', hypetrain: 'hype'
}

export const chatEventGroup = (type: EventType): ChatEventGroup | undefined => GROUP[type]

/** Puts an event into the chat stream. Returns null for events that stay in the drawer only. */
export function eventToMessage(e: StreamEvent): ChatMessage | null {
  if (e.noChat || e.history || !GROUP[e.type]) return null
  return {
    id: `event:${e.id}`,
    platform: e.platform,
    ts: e.ts,
    kind: 'event',
    event: e,
    parts: [],
    author: { id: '', name: e.actor ?? '', badges: [] }
  }
}
