import { parseText } from '../../../shared/parts'
import type { Badge, ChatMessage, MessagePart, StreamEvent } from '../../../shared/types'

/**
 * TikTok items as Rust sends them (core/src/tiktok/mod.rs, decode_batch). Every field is optional
 * in practice: the protocol is unofficial, so nothing here may throw on a missing one.
 */
export interface TikTokUser { id?: string; login?: string; name?: string; avatar?: string }
export interface TikTokIdentity { mod?: boolean; sub?: boolean; anchor?: boolean; gifter?: boolean; follower?: boolean }
export interface TikTokItem {
  kind: 'chat' | 'emote' | 'gift' | 'follow' | 'share' | 'social' | 'like' | 'sub' | 'viewers' | 'control'
  id?: string
  ts?: number
  user?: TikTokUser | null
  identity?: TikTokIdentity
  text?: string
  emotes?: { index?: number; id?: string; url?: string | null }[]
  // gifts
  giftId?: string
  name?: string
  image?: string | null
  diamonds?: number
  streakable?: boolean
  repeat?: number
  end?: boolean
  group?: string
  // likes / subs / viewers / control
  count?: number
  total?: number
  months?: number
  viewers?: number
  action?: number
}

/** What a creator gets per diamond, roughly. TikTok doesn't publish it; this is the common figure. */
export const USD_PER_DIAMOND = 0.005

let seq = 0
export const tiktokEvent = (over: Omit<StreamEvent, 'id' | 'platform' | 'ts' | 'details'> & { id?: string; ts?: number; details?: Record<string, string> }): StreamEvent => ({
  platform: 'tiktok', details: {}, ...over, id: over.id ?? `tiktok-${Date.now()}-${++seq}`, ts: over.ts ?? Date.now()
})

const who = (u?: TikTokUser | null): string => u?.name?.trim() || (u?.login ? `@${u.login}` : 'Someone')

function badges(i: TikTokIdentity = {}): Badge[] {
  const out: Badge[] = []
  if (i.anchor) out.push({ id: 'broadcaster', title: 'Broadcaster' })
  if (i.mod) out.push({ id: 'moderator', title: 'Moderator' })
  if (i.sub) out.push({ id: 'subscriber', title: 'Subscriber' })
  if (i.gifter) out.push({ id: 'gifter', title: 'Gift giver' })
  return out
}

/**
 * TikTok sends sticker emotes separately, each with the character position it sits at in the
 * text (the text itself leaves them out).
 */
export function chatParts(text: string, emotes: TikTokItem['emotes'] = []): MessagePart[] {
  const usable = (emotes ?? []).filter((e) => e.url).sort((a, b) => (a.index ?? 0) - (b.index ?? 0))
  if (!usable.length) return parseText(text)
  const chars = Array.from(text)
  const out: MessagePart[] = []
  let at = 0
  for (const e of usable) {
    const i = Math.min(Math.max(e.index ?? chars.length, at), chars.length)
    if (i > at) out.push(...parseText(chars.slice(at, i).join('')))
    out.push({ type: 'emote', name: e.id ? `:${e.id}:` : 'emote', url: e.url! })
    at = i
  }
  if (at < chars.length) out.push(...parseText(chars.slice(at).join('')))
  return out
}

export function toMessage(it: TikTokItem): ChatMessage | null {
  if (!it.id || !it.user) return null
  const parts = it.kind === 'emote'
    ? (it.emotes ?? []).filter((e) => e.url).map((e): MessagePart => ({ type: 'emote', name: e.id ? `:${e.id}:` : 'emote', url: e.url! }))
    : chatParts(it.text ?? '', it.emotes)
  if (!parts.length) return null
  const identity = it.identity ?? {}
  return {
    id: `tiktok-${it.id}`, platform: 'tiktok', ts: it.ts || Date.now(), kind: 'chat',
    author: {
      id: it.user.id ?? '', name: who(it.user), login: it.user.login, badges: badges(identity),
      isBroadcaster: !!identity.anchor, isMod: !!identity.mod, isMember: !!identity.sub
    },
    parts
  }
}

const coins = (n: number): string => `${n.toLocaleString('en-US')} coin${n === 1 ? '' : 's'}`

/** "~$0.03". Tiny gifts say "<$0.01" so a Rose doesn't read as free. */
export function usd(diamonds: number): string {
  // in whole cents first, so 199 diamonds is $1.00 and not a float's $0.99
  if (diamonds * USD_PER_DIAMOND < 0.01) return '<$0.01'
  const cents = Math.round(Math.round(diamonds * USD_PER_DIAMOND * 1000) / 10)
  return `~$${(cents / 100).toFixed(2)}`
}

/** A finished gift (or streak): "Name sent Rose ×5 · 5 coins (~$0.03)". */
export interface FinishedGift { key: string; ts: number; user?: TikTokUser | null; name: string; image?: string | null; diamonds: number; count: number }

export function giftEvent(g: FinishedGift): StreamEvent {
  const total = g.diamonds * g.count
  const name = g.name || 'a gift'
  return tiktokEvent({
    id: `tiktok-gift-${g.key}`, ts: g.ts, type: 'gift', actor: who(g.user), text: 'sent',
    subject: g.count > 1 ? `${name} ×${g.count}` : name,
    amount: total > 0 ? `${coins(total)} (${usd(total)})` : undefined,
    image: g.image || undefined,
    // about $5 to the creator and up gets the big card
    big: total >= 1000,
    details: {
      Gift: name, Count: String(g.count), Coins: total.toLocaleString('en-US'),
      'Approx. value': total > 0 ? `${usd(total)} to the creator` : 'Free gift',
      ...(g.user?.login ? { Account: `@${g.user.login}` } : {})
    }
  })
}

/** Everything that isn't chat or a gift. Gifts go through GiftStreaks, likes through LikeTally. */
export function toEvent(it: TikTokItem): StreamEvent | null {
  const base = { ts: it.ts || Date.now(), actor: who(it.user) }
  switch (it.kind) {
    case 'follow':
      // TikTok can repeat a follow; one per person per day is plenty
      return it.user ? tiktokEvent({ ...base, id: `tiktok-follow-${it.user.id || it.id}-${new Date(base.ts).toISOString().slice(0, 10)}`, type: 'follow', text: 'followed' }) : null
    case 'share':
      return it.user ? tiktokEvent({ ...base, id: it.id && `tiktok-${it.id}`, type: 'other', text: 'shared the LIVE' }) : null
    case 'sub': {
      if (!it.user) return null
      const months = Number(it.months) || undefined
      return tiktokEvent({ ...base, id: it.id && `tiktok-${it.id}`, type: 'sub', text: months && months > 1 ? `resubscribed (${months} months)` : 'subscribed', months })
    }
    default:
      return null
  }
}
