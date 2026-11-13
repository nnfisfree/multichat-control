import { parseText } from '../../../shared/parts'
import type { EmoteLookup } from '../../../shared/parts'
import type { Badge, ChatMessage, HypeTrain, MessagePart, StreamEvent } from '../../../shared/types'
import { log } from '../../log'

export type BadgeMap = ReadonlyMap<string, Badge>
/** Cheermote prefix (lowercase) to its tiers, lowest first. */
export type CheerMap = ReadonlyMap<string, { minBits: number; url: string }[]>

const NO_CHEERS: CheerMap = new Map()

export function cheermoteUrl(cheers: CheerMap, prefix: string, bits: number): string | undefined {
  let url: string | undefined
  for (const t of cheers.get(prefix.toLowerCase()) ?? []) if (t.minBits <= bits) url = t.url
  return url
}

const emoteUrl = (id: string, format: string[] = []): string =>
  `https://static-cdn.jtvnw.net/emoticons/v2/${id}/${format.includes('animated') ? 'default' : 'static'}/dark/2.0`

export function fragmentsToParts(fragments: any[] | undefined, text: string, third: EmoteLookup, cheers: CheerMap = NO_CHEERS): MessagePart[] {
  if (!fragments?.length) return parseText(text, third)
  return fragments.flatMap((f): MessagePart[] => {
    if (f.type === 'emote' && f.emote) return [{ type: 'emote', name: f.text, url: emoteUrl(f.emote.id, f.emote.format) }]
    // Twitch requires the GIF URL to be used exactly as given.
    if (f.type === 'gif' && f.gif?.url) return [{ type: 'gif', url: f.gif.url, alt: String(f.text ?? 'GIF').replace(/^\[|\]$/g, '') }]
    if (f.type === 'cheermote' && f.cheermote) {
      const url = cheermoteUrl(cheers, f.cheermote.prefix, f.cheermote.bits)
      return url ? [{ type: 'emote', name: f.text, url }, { type: 'text', text: `${f.cheermote.bits}` }] : parseText(f.text, third)
    }
    return parseText(f.text, third)
  })
}

function badgesOf(list: any[] | undefined, map: BadgeMap): Badge[] {
  return (list ?? []).map((b) => map.get(`${b.set_id}/${b.id}`) ?? { id: b.set_id, title: b.set_id })
}

function author(e: any, map: BadgeMap): ChatMessage['author'] {
  const badges = e.badges ?? []
  return {
    id: e.chatter_user_id,
    name: e.chatter_user_name,
    login: e.chatter_user_login,
    color: e.color || undefined,
    badges: badgesOf(badges, map),
    isBroadcaster: badges.some((b: any) => b.set_id === 'broadcaster'),
    isMod: badges.some((b: any) => b.set_id === 'moderator'),
    isVip: badges.some((b: any) => b.set_id === 'vip')
  }
}

export function chatMessage(e: any, badges: BadgeMap, third: EmoteLookup, cheers: CheerMap = NO_CHEERS): ChatMessage {
  const action = /^\u0001ACTION /.test(e.message.text)
  const bits: number | undefined = e.cheer?.bits
  const highlighted = e.message_type === 'channel_points_highlighted'
  return {
    id: e.message_id,
    platform: 'twitch',
    ts: Date.now(),
    author: author(e, badges),
    parts: fragmentsToParts(e.message.fragments, e.message.text, third, cheers),
    kind: bits ? 'cheer' : highlighted ? 'highlight' : action ? 'action' : 'chat',
    label: bits ? `${bits} BITS` : highlighted ? 'HIGHLIGHTED MESSAGE' : undefined,
    effect: e.message_type === 'power_ups_gigantified_emote' ? 'giant' : e.message_type === 'power_ups_message_effect' ? 'message-effect' : undefined,
    firstTime: e.message_type === 'user_intro',
    reply: e.reply ? { author: e.reply.parent_user_name, text: e.reply.parent_message_body } : undefined
  }
}

const event = (id: string, partial: Omit<StreamEvent, 'id' | 'platform' | 'ts' | 'details'> & { details?: Record<string, string> }): StreamEvent => ({
  id, platform: 'twitch', ts: Date.now(), details: {}, ...partial
})

const TIER: Record<string, string> = { '1000': 'Tier 1', '2000': 'Tier 2', '3000': 'Tier 3', prime: 'Prime' }

/** Turns a chat notification into a highlighted chat line and/or an event. */
export function notification(e: any, badges: BadgeMap, third: EmoteLookup): { message?: ChatMessage; event?: StreamEvent } {
  const who = e.chatter_is_anonymous ? 'Anonymous' : e.chatter_user_name
  const said = e.message?.text || undefined
  const id = e.message_id
  // In a shared chat, other channels' subs, gifts and raids are theirs, not events of this channel.
  if (e.source_broadcaster_user_id && e.source_broadcaster_user_id !== e.broadcaster_user_id) return {}
  switch (e.notice_type) {
    case 'announcement':
      return {
        message: { ...chatMessage({ ...e, message_type: 'text', reply: null }, badges, third), kind: 'announcement', label: 'Announcement' },
        event: event(id, { type: 'announcement', noChat: true, actor: who, text: 'announced', message: said, details: { Colour: e.announcement?.color ?? 'primary' } })
      }
    case 'sub':
      return { event: event(id, { type: 'sub', actor: who, text: `subscribed to the channel${e.sub?.duration_months > 1 ? ` (${e.sub.duration_months} months)` : ''}`, message: said, amount: TIER[e.sub?.is_prime ? 'prime' : e.sub?.sub_tier] }) }
    case 'resub':
      return { event: event(id, { type: 'sub', actor: who, text: `resubscribed to the channel (${e.resub?.cumulative_months ?? '?'} months)`, message: said, amount: TIER[e.resub?.is_prime ? 'prime' : e.resub?.sub_tier], details: { Streak: String(e.resub?.streak_months ?? 'hidden') } }) }
    case 'sub_gift':
      // A gift bomb sends its summary notice first, then one of these per recipient: each gets its own line.
      return { event: event(id, { type: 'gift', actor: who, text: `gifted a ${TIER[e.sub_gift?.sub_tier] ? `${TIER[e.sub_gift.sub_tier]} ` : ''}sub to`, subject: e.sub_gift?.recipient_user_name, details: { Recipient: e.sub_gift?.recipient_user_name ?? '', Tier: TIER[e.sub_gift?.sub_tier] ?? '', Months: String(e.sub_gift?.duration_months ?? 1) } }) }
    case 'community_sub_gift':
      return { event: event(id, { type: 'gift', big: e.community_sub_gift?.total >= 5, actor: who, text: `gifted ${e.community_sub_gift?.total} subs to the community`, amount: `${TIER[e.community_sub_gift?.sub_tier] ?? ''} x${e.community_sub_gift?.total}`.trim(), details: { Tier: TIER[e.community_sub_gift?.sub_tier] ?? '', 'Total gifted': String(e.community_sub_gift?.cumulative_total ?? 'hidden') } }) }
    case 'gift_paid_upgrade':
    case 'prime_paid_upgrade':
      return { event: event(id, { type: 'sub', actor: who, text: 'upgraded their sub' }) }
    case 'pay_it_forward':
      return { event: event(id, { type: 'gift', actor: who, text: 'paid a gift forward' }) }
    case 'raid':
      return { event: event(id, { type: 'raid', big: true, actor: e.raid?.user_name, text: `raided with ${e.raid?.viewer_count} viewers`, amount: String(e.raid?.viewer_count) }) }
    case 'bits_badge_tier':
      return { event: event(id, { type: 'cheer', actor: who, text: `unlocked the ${e.bits_badge_tier?.tier} Bits badge` }) }
    case 'charity_donation':
      return { event: event(id, { type: 'paid', actor: who, text: `donated to ${e.charity_donation?.charity_name}` }) }
    default:
      return {}
  }
}

const AUTOMATIC: Record<string, string> = {
  send_highlighted_message: 'Highlight My Message',
  single_message_bypass_sub_mode: 'Send a Message in Sub-Only Mode',
  random_sub_emote_unlock: 'Unlock a Random Sub Emote',
  chosen_sub_emote_unlock: 'Choose an Emote to Unlock',
  chosen_modified_sub_emote_unlock: 'Modify a Single Emote',
  message_effect: 'Message Effects',
  gigantify_an_emote: 'Gigantify an Emote',
  celebration: 'On-Screen Celebration'
}

const POWER_UP: Record<string, string> = { message_effect: 'Message Effects', gigantify_an_emote: 'Gigantify an Emote', celebration: 'On-Screen Celebration' }

const minutes = (seconds: number): string => (seconds >= 60 ? `${Math.round(seconds / 60)}m` : `${seconds}s`)

/** Reads a Hype Train update. Twitch's docs vary on `top_contributions`, so one or many are accepted. */
export function hypeTrain(e: any): HypeTrain {
  const type = e.type === 'golden_kappa' || e.type === 'treasure' ? e.type : 'regular'
  return {
    platform: 'twitch', level: e.level ?? 1, progress: e.progress ?? 0, goal: e.goal ?? 0, total: e.total ?? 0, type,
    expiresAt: Date.parse(e.expires_at) || Date.now() + 300000,
    top: [].concat(e.top_contributions ?? []).slice(0, 3).map((c: any) => ({ name: c.user_name, kind: c.type, total: c.total }))
  }
}

/** Normalizes one EventSub notification. `manageable` holds reward IDs this app may fulfil. */
export function eventFromSub(type: string, id: string, e: any, manageable: ReadonlySet<string>): StreamEvent | null {
  const mk = (partial: Parameters<typeof event>[1]): StreamEvent => event(id, partial)
  switch (type) {
    case 'channel.follow': {
      const ts = Date.parse(e.followed_at) || Date.now()
      return { ...mk({ type: 'follow', actor: e.user_name, text: 'followed' }), id: `follow-${e.user_id}-${ts}`, ts }
    }
    case 'channel.channel_points_custom_reward_redemption.add': {
      const canManage = e.status === 'unfulfilled' && manageable.has(e.reward.id)
      return mk({
        type: 'redemption', actor: e.user_name, text: 'redeemed', subject: e.reward.title, amount: String(e.reward.cost), message: e.user_input || undefined,
        details: { Reward: e.reward.title, Cost: String(e.reward.cost), Status: e.status, Prompt: e.reward.prompt ?? '' },
        actions: canManage ? [
          { actionId: 'reward.fulfill', label: 'Fulfil', args: { rewardId: e.reward.id, redemptionId: e.id }, tone: 'good' },
          { actionId: 'reward.cancel', label: 'Refund', args: { rewardId: e.reward.id, redemptionId: e.id }, tone: 'bad' }
        ] : undefined
      })
    }
    case 'channel.channel_points_automatic_reward_redemption.add': {
      const reward = e.reward?.type ?? e.type
      return mk({
        type: 'redemption', actor: e.user_name, text: 'redeemed', subject: AUTOMATIC[reward] ?? reward, amount: e.reward?.channel_points != null ? String(e.reward.channel_points) : undefined,
        message: e.message?.text || e.user_input || undefined, details: { Reward: AUTOMATIC[reward] ?? reward }
      })
    }
    case 'channel.custom_power_up_redemption.add': {
      // Twitch's docs don't pin down where the name lives, so every likely spot is read.
      const p = e.custom_power_up ?? e.power_up ?? e.reward ?? {}
      const name = p.title ?? p.name ?? e.title ?? e.custom_power_up_title ?? e.power_up_title
      const bits = p.bits ?? p.cost ?? e.bits
      if (!name) log('twitch', `custom Power-up without a name: ${JSON.stringify(e).slice(0, 600)}`)
      return mk({ type: 'powerup', actor: e.user_name, text: 'used', subject: name ?? 'a custom Power-up', amount: bits != null ? `${bits} bits` : undefined, message: e.user_input || e.message?.text || undefined, details: name ? { 'Power-up': name } : {} })
    }
    case 'channel.bits.use': {
      if (e.type === 'power_up') {
        const name = POWER_UP[e.power_up?.type] ?? e.power_up?.type ?? 'a Power-up'
        // These two change a chat message, which already shows in chat.
        const onMessage = e.power_up?.type === 'message_effect' || e.power_up?.type === 'gigantify_an_emote'
        return mk({ type: 'powerup', noChat: onMessage, actor: e.user_name, text: 'used', subject: name, amount: `${e.bits} bits`, message: e.message?.text || undefined })
      }
      return mk({ type: 'cheer', noChat: true, actor: e.user_name, text: 'cheered', amount: `${e.bits} bits`, message: e.message?.text || undefined })
    }
    case 'channel.raid':
      return mk({ type: 'raid', big: true, actor: e.from_broadcaster_user_name, text: `started a raid on channel ${e.to_broadcaster_user_name}`, amount: String(e.viewers) })
    case 'channel.ban': {
      const secs = e.ends_at ? Math.max(0, Math.round((Date.parse(e.ends_at) - Date.parse(e.banned_at)) / 1000)) : 0
      return mk({ type: 'moderation', actor: e.moderator_user_name, text: `${e.is_permanent ? 'banned' : 'timed out'} ${e.user_name}`, amount: e.is_permanent ? undefined : minutes(secs), details: { Reason: e.reason || 'None given' } })
    }
    case 'channel.unban':
      return mk({ type: 'moderation', actor: e.moderator_user_name, text: `unbanned ${e.user_name}` })
    case 'channel.shoutout.create':
      return mk({ type: 'shoutout', actor: e.moderator_user_name, text: `shouted out ${e.to_broadcaster_user_name}` })
    case 'channel.hype_train.begin':
      return mk({ type: 'hypetrain', big: true, text: 'Hype Train started!', amount: `Level ${e.level ?? 1}` })
    case 'channel.hype_train.end':
      return mk({ type: 'hypetrain', big: true, text: 'Hype Train ended', amount: `Level ${e.level ?? '?'}`, details: { Total: String(e.total ?? '') } })
    case 'channel.poll.begin':
      return mk({ type: 'poll', text: `Poll started: ${e.title}`, details: Object.fromEntries((e.choices ?? []).map((c: any, i: number) => [`Choice ${i + 1}`, c.title])) })
    case 'channel.poll.end':
      return mk({ type: 'poll', text: `Poll ended: ${e.title}`, details: Object.fromEntries((e.choices ?? []).map((c: any) => [c.title, `${c.votes ?? 0} votes`])) })
    case 'channel.prediction.begin':
      return mk({ type: 'prediction', text: `Prediction started: ${e.title}`, details: Object.fromEntries((e.outcomes ?? []).map((o: any, i: number) => [`Outcome ${i + 1}`, o.title])) })
    case 'channel.prediction.lock':
      return mk({ type: 'prediction', text: `Prediction locked: ${e.title}` })
    case 'channel.prediction.end':
      return mk({ type: 'prediction', text: `Prediction ended: ${e.title}`, details: { Status: e.status ?? '' } })
    case 'channel.goal.begin':
      return mk({ type: 'goal', text: `Goal started: ${e.description || e.type}`, amount: String(e.target_amount) })
    case 'channel.goal.end':
      return mk({ type: 'goal', text: `Goal ${e.is_achieved ? 'achieved' : 'ended'}: ${e.description || e.type}`, amount: `${e.current_amount}/${e.target_amount}` })
    case 'channel.ad_break.begin':
      return mk({ type: 'ad', text: `Ad break started${e.is_automatic ? ' automatically' : ''}`, amount: minutes(e.duration_seconds ?? 0) })
    case 'stream.online':
      return mk({ type: 'stream', text: 'Stream went live' })
    case 'stream.offline':
      return mk({ type: 'stream', text: 'Stream went offline' })
    default:
      return null
  }
}
