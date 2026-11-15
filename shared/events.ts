import type { AlertSource, ChatEventGroup, ChatMessage, EventType, StreamEvent } from './types'

/**
 * Tips (from any alert service) and anything from BMC don't belong to a platform. They get their
 * service's colours and logo, show on every tab and ignore the platform filter. Follows/subs that
 * an alert service relays from Twitch or YouTube still count as that platform's.
 */
export const standaloneSource = (e: Pick<StreamEvent, 'type' | 'source'>): AlertSource | undefined =>
  e.source && (e.type === 'donation' || e.source === 'buymeacoffee') ? e.source : undefined

/**
 * Total months for a resub (2+). Events saved before the `months` field existed only have it in
 * their text ("resubscribed (14 months)") or amount ("14 months"), so fall back to parsing.
 */
export function subMonths(e: Pick<StreamEvent, 'type' | 'months' | 'text' | 'amount'>): number | undefined {
  if (e.type !== 'sub') return undefined
  const n = e.months ?? Number(/\((\d+) months?\)/.exec(e.text)?.[1] ?? /^(\d+) months?$/.exec(e.amount ?? '')?.[1] ?? 0)
  return n > 1 ? n : undefined
}

// short badge on the right of each event
export const EVENT_BADGE: Record<EventType, string> = {
  redemption: 'CP', sub: 'SUB', gift: 'GIFT', cheer: 'BITS', bits: 'BITS', raid: 'RAID', powerup: 'PWR', follow: 'FLW',
  paid: 'TIP', hypetrain: 'HYPE', poll: 'POLL', prediction: 'PRED', goal: 'GOAL', ad: 'AD', shoutout: 'SO',
  moderation: 'MOD', stream: 'LIVE', donation: 'TIP', announcement: 'ANN', other: 'INFO'
}

/** YouTube and BMC call them memberships, not subs. */
export const isMembership = (e: Partial<Pick<StreamEvent, 'type' | 'source' | 'platform'>>): boolean =>
  e.type === 'sub' && (e.source === 'buymeacoffee' || e.platform === 'youtube')

// a finished stream says OFF instead of LIVE
export const eventBadge = (e: Pick<StreamEvent, 'type' | 'text'> & Partial<Pick<StreamEvent, 'source' | 'platform'>>): string =>
  e.type === 'stream' && /offline|ended/i.test(e.text) ? 'OFF'
    : isMembership(e) ? 'MEM'
    : EVENT_BADGE[e.type]

const GROUP: Partial<Record<EventType, ChatEventGroup>> = {
  sub: 'subs', gift: 'gifts', cheer: 'cheers', raid: 'raids', redemption: 'redemptions',
  powerup: 'powerups', follow: 'follows', paid: 'paid', donation: 'donations', hypetrain: 'hype'
}

export const chatEventGroup = (type: EventType): ChatEventGroup | undefined => GROUP[type]

/** Event -> chat row. null for events that only live in the drawer. */
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

const ENTITIES: Record<string, string> = { amp: '&', lt: '<', gt: '>', quot: '"', apos: "'", nbsp: ' ' }

/**
 * Buy Me a Coffee sends supporter notes as HTML, and signs them with the supporter's name on a new
 * line ("See you there!<br>Kiski"). Turns that into plain text and drops a last line that only
 * repeats the name, since the card already starts with it. Only real tags are removed, so "<3" stays.
 */
export function plainNote(note: string | undefined, name?: string): string | undefined {
  if (!note) return undefined
  const lines = note
    .replace(/<br\s*\/?>|<\/p>|<\/div>/gi, '\n')
    .replace(/<\/?[a-z][^>]*>/gi, '')
    .replace(/&(#x[0-9a-f]+|#\d+|[a-z]+);/gi, (all, e: string) => {
      const code = e[0] === '#' ? (e[1] === 'x' || e[1] === 'X' ? parseInt(e.slice(2), 16) : parseInt(e.slice(1), 10)) : NaN
      if (!Number.isNaN(code)) return code > 0 && code <= 0x10ffff ? String.fromCodePoint(code) : all
      return ENTITIES[e.toLowerCase()] ?? all
    })
    .split('\n')
    .map((l) => l.trim())
    .filter(Boolean)
  const who = name?.trim().toLowerCase()
  if (who && lines.length > 1 && lines[lines.length - 1].toLowerCase() === who) lines.pop()
  return lines.join(' ') || undefined
}
