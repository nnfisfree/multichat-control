import type { Platform, StreamEvent } from '../shared/types'
import { money, text, tier } from './integrations/alerts'

/**
 * Streamer.bot's test triggers (right-click a trigger → Test, or an action run with a test
 * trigger) fire the same events as the real thing, marked isTest. Real events already reach the
 * app straight from the platforms, so only the tests are turned into events here.
 */

const PLATFORM: Record<string, Platform> = { twitch: 'twitch', youtube: 'youtube', kick: 'kick' }

/** The events asked for from each Streamer.bot category. */
export const SB_TEST_EVENTS: Record<string, string[]> = {
  Twitch: ['Follow', 'Cheer', 'Sub', 'ReSub', 'GiftSub', 'GiftBomb', 'Raid', 'RewardRedemption'],
  Kick: ['Follow', 'Subscription', 'Resubscription', 'GiftSubscription', 'MassGiftSubscription', 'RewardRedemption', 'KicksGifted'],
  YouTube: ['NewSubscriber', 'SuperChat', 'SuperSticker', 'NewSponsor', 'MemberMileStone', 'MembershipGift']
}

const num = (...vs: unknown[]): number => {
  for (const v of vs) {
    const n = Number(v)
    if (Number.isFinite(n) && n > 0) return n
  }
  return 0
}

/** A user's shown name, wherever this event keeps it. */
function who(...us: any[]): string {
  for (const u of us) {
    if (!u) continue
    const n = typeof u === 'string' ? text(u) : text(u.name) ?? text(u.displayName) ?? text(u.display_name) ?? text(u.login) ?? text(u.username)
    if (n) return n
  }
  return 'Someone'
}

const isTest = (d: any): boolean => d?.isTest === true || d?.meta?.isTest === true

let seq = 0

/** One Streamer.bot event as a test event, or null when it's real or not one the app shows. */
export function sbTestEvent(source: string, type: string, d: any): StreamEvent | null {
  const platform = PLATFORM[source.toLowerCase()]
  if (!platform || !d || !isTest(d)) return null
  const base = { id: `sb-test-${Date.now()}-${++seq}`, platform, ts: Date.now(), details: {} as Record<string, string>, test: true as const }
  const user = d.user ?? d.userName ?? d.user_name ?? d.displayName
  const subTier = tier(d.isPrime ? 'prime' : d.subTier ?? d.tier)
  const months = num(d.cumulativeMonths, d.cumulative, d.duration, d.months)
  const key = `${source.toLowerCase()}.${type.toLowerCase()}`
  switch (key) {
    case 'twitch.follow':
    case 'kick.follow':
      return { ...base, type: 'follow', actor: who(user, d.targetUser), text: 'followed' }
    case 'youtube.newsubscriber':
      return { ...base, type: 'follow', actor: who(user), text: 'subscribed' }
    case 'twitch.cheer':
      return { ...base, type: 'cheer', actor: d.anonymous ? 'Anonymous' : who(user), text: 'cheered', amount: `${num(d.bits)} bits`, message: text(d.text) ?? text(d.message) }
    case 'twitch.sub':
    case 'kick.subscription':
      return { ...base, type: 'sub', actor: who(user), text: 'subscribed', amount: subTier }
    case 'twitch.resub':
    case 'kick.resubscription':
      return { ...base, type: 'sub', actor: who(user), text: months > 1 ? `resubscribed (${months} months)` : 'resubscribed', amount: subTier, message: text(d.text) }
    case 'twitch.giftsub':
    case 'kick.giftsubscription': {
      const to = d.recipient ?? d.recipients?.[0] ?? d.giftee
      return { ...base, type: 'gift', actor: who(user, d.gifter), text: `gifted a sub to ${who(to)}`, amount: subTier }
    }
    case 'twitch.giftbomb':
    case 'kick.massgiftsubscription': {
      const n = num(d.total, d.count, d.recipients?.length)
      return { ...base, type: 'gift', big: n >= 5, actor: who(user, d.gifter), text: `gifted ${n || 'some'} subs to the community`, amount: subTier && n ? `${subTier} x${n}` : subTier }
    }
    case 'twitch.raid':
      return { ...base, type: 'raid', big: true, actor: who(d.raider, user), text: 'raided the channel', amount: `${num(d.viewers)} viewers` }
    case 'twitch.rewardredemption':
    case 'kick.rewardredemption':
      return {
        ...base, type: 'redemption', actor: who(user), text: 'redeemed', subject: text(d.reward?.title) ?? text(d.rewardTitle) ?? text(d.title),
        amount: d.reward?.cost != null ? String(d.reward.cost) : undefined, message: text(d.userInput)
      }
    case 'kick.kicksgifted':
      return { ...base, type: 'paid', actor: who(user, d.sender), text: 'gifted Kicks', amount: `${num(d.amount, d.kicks, d.gift?.amount)} Kicks`, message: text(d.message) }
    case 'youtube.superchat':
      return { ...base, type: 'paid', actor: who(user), text: 'sent a Super Chat', amount: text(d.amount) ?? money(d.decimalAmount, d.currencyCode), message: text(d.message) }
    case 'youtube.supersticker':
      return { ...base, type: 'paid', actor: who(user), text: 'sent a Super Sticker', amount: text(d.amount) ?? money(d.decimalAmount, d.currencyCode) }
    case 'youtube.newsponsor':
      return { ...base, type: 'sub', actor: who(user), text: 'became a member', amount: text(d.levelName) }
    case 'youtube.membermilestone':
      return { ...base, type: 'sub', actor: who(user), text: months > 1 ? `is a member (${months} months)` : 'is a member', amount: text(d.levelName), message: text(d.message) }
    case 'youtube.membershipgift': {
      const n = num(d.count, d.total, d.giftCount)
      return { ...base, type: 'gift', big: n >= 5, actor: who(user), text: `gifted ${n || 'some'} memberships` }
    }
    default:
      return null
  }
}
