import type { EmoteLookup } from '../../../shared/parts'
import type { ChatMessage, HeldInfo, MessageFlag } from '../../../shared/types'
import { fragmentsToParts, type CheerMap } from './normalize'

/** The row id of a held message, kept apart from the id it gets in chat once it is allowed. */
export const heldRowId = (messageId: string): string => `held:${messageId}`

/** AutoMod's category names, in plain words. Unknown ones are tidied up and shown as they are. */
const CATEGORY: Record<string, string> = {
  aggressive: 'Aggression', aggression: 'Aggression', bullying: 'Bullying', disability: 'Disability',
  sexuality: 'Sexuality or gender', sexuality_sex_or_gender: 'Sexuality or gender', misogyny: 'Misogyny',
  homophobia: 'Sexuality or gender', racism: 'Race, ethnicity or religion', race_ethnicity_or_religion: 'Race, ethnicity or religion',
  sexwords: 'Sex-based terms', sex_based_terms: 'Sex-based terms', profanity: 'Swearing', swearing: 'Swearing'
}

const category = (c: unknown): string => {
  const key = String(c ?? '').toLowerCase()
  return CATEGORY[key] ?? (key ? key.replace(/_/g, ' ').replace(/^./, (x) => x.toUpperCase()) : 'Unknown')
}

/** Why a message was held, from automod.message.hold (version 2). */
function heldReason(e: any): string {
  if (e.reason === 'blocked_link') return 'Blocked link'
  if (e.reason === 'blocked_term') {
    const n = e.blocked_term?.terms_found?.length ?? 0
    return n > 1 ? `${n} blocked terms` : 'Blocked term'
  }
  const level = Number(e.automod?.level ?? e.level)
  return `AutoMod: ${category(e.automod?.category ?? e.category)}${level ? ` (level ${level})` : ''}`
}

/** A held message as a chat row that only the moderator sees, waiting for Allow or Deny. */
export function heldMessage(e: any, third: EmoteLookup, cheers: CheerMap): ChatMessage {
  return {
    id: heldRowId(String(e.message_id)),
    platform: 'twitch',
    ts: Date.parse(e.held_at) || Date.now(),
    kind: 'chat',
    author: { id: String(e.user_id ?? ''), name: e.user_name ?? e.user_login ?? 'Someone', login: e.user_login, badges: [] },
    parts: fragmentsToParts(e.message?.fragments, e.message?.text ?? '', third, cheers),
    held: { reason: heldReason(e), status: 'pending' }
  }
}

/** The outcome in automod.message.update. Twitch's docs write it both "Approved" and "approved". */
export function heldStatus(status: unknown): HeldInfo['status'] | null {
  switch (String(status ?? '').toLowerCase()) {
    case 'approved': case 'allowed': return 'allowed'
    case 'denied': return 'denied'
    case 'expired': return 'expired'
    default: return null
  }
}

/** Twitch's warning for a message from a suspicious user (channel.suspicious_user.message). */
export function suspiciousFlag(e: any): MessageFlag | null {
  const types: string[] = Array.isArray(e.types) ? e.types : []
  const status = String(e.low_trust_status ?? '')
  if (status !== 'restricted' && status !== 'active_monitoring' && !types.length) return null
  const notes: string[] = []
  if (status === 'restricted') notes.push('Restricted: only moderators see their messages')
  else if (status === 'active_monitoring') notes.push('Monitored by the channel')
  if (types.includes('ban_evader')) {
    const guess = String(e.ban_evasion_evaluation ?? '')
    notes.push(guess === 'likely' ? 'Likely ban evader' : guess === 'possible' ? 'Possible ban evader' : 'Ban evader')
  }
  if (types.includes('banned_in_shared_channel')) {
    const n = Array.isArray(e.shared_ban_channel_ids) ? e.shared_ban_channel_ids.length : 0
    notes.push(n ? `Banned in ${n} channel${n === 1 ? '' : 's'} that share ban info with you` : 'Banned in a channel that shares ban info with you')
  }
  if (types.includes('manually_added')) notes.push('Marked by a moderator')
  return { kind: 'suspicious', label: status === 'restricted' ? 'Restricted user' : 'Suspicious user', notes }
}

/**
 * A suspicious user's message built from the warning itself, for when Twitch doesn't also send it
 * as a normal chat message (restricted users' messages reach only moderators).
 */
export function suspiciousMessage(e: any, flag: MessageFlag, third: EmoteLookup, cheers: CheerMap): ChatMessage {
  return {
    id: String(e.message?.message_id ?? `suspicious-${Date.now()}`),
    platform: 'twitch',
    ts: Date.now(),
    kind: 'chat',
    author: { id: String(e.user_id ?? ''), name: e.user_name ?? e.user_login ?? 'Someone', login: e.user_login, badges: [] },
    parts: fragmentsToParts(e.message?.fragments, e.message?.text ?? '', third, cheers),
    flag
  }
}
