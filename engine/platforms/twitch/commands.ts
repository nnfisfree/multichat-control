import type { ActionResult, RaidInfo, UserEntry } from '../../../shared/types'
import type { Helix } from './connector'
import { startRaid } from './raid'

/** What a command returns: a message for the streamer, and sometimes something to open. */
export type CommandResult = ActionResult & { openUser?: UserEntry; pinned?: boolean; raid?: RaidInfo | null }

const UNITS: Record<string, number> = { s: 1, m: 60, h: 3600, d: 86400, w: 604800, mo: 2592000 }

/** "90", "90s", "10m", "1h", "2d", "1w" or "1mo" in seconds; a bare number uses the given unit. */
export function parseDuration(text: string | undefined, bareUnit: keyof typeof UNITS = 's'): number | null {
  const m = /^(\d+)\s*(mo|s|m|h|d|w)?$/i.exec(text?.trim() ?? '')
  return m ? Number(m[1]) * UNITS[(m[2] ?? bareUnit).toLowerCase()] : null
}

const say = (seconds: number): string => {
  if (seconds % 86400 === 0) return `${seconds / 86400} day${seconds === 86400 ? '' : 's'}`
  if (seconds % 3600 === 0) return `${seconds / 3600} hour${seconds === 3600 ? '' : 's'}`
  if (seconds % 60 === 0) return `${seconds / 60} minute${seconds === 60 ? '' : 's'}`
  return `${seconds} second${seconds === 1 ? '' : 's'}`
}

const ok = (message: string): CommandResult => ({ ok: true, message })
const fail = (message: string): CommandResult => ({ ok: false, message })

/**
 * Twitch's chat commands, done through Twitch's API: typing "/raid x" into chat through the API
 * would only post the text, so each command calls the matching endpoint instead.
 */
export async function runTwitchCommand(helix: Helix, me: string, input: string, send: (text: string) => Promise<string | undefined>): Promise<CommandResult | null> {
  const [head, ...rest] = input.trim().split(/\s+/)
  const name = head.toLowerCase().replace(/^\//, '')
  const arg = rest.join(' ')
  const mod = { broadcaster_id: me, moderator_id: me }
  const user = async (login: string | undefined): Promise<{ id: string; name: string; login: string }> => {
    const clean = (login ?? '').replace(/^@/, '').toLowerCase()
    if (!clean) throw new Error('Add a name, like /' + name + ' username.')
    const u = (await helix('GET', '/users', { login: clean }))?.data?.[0]
    if (!u) throw new Error(`Twitch has no user called "${clean}".`)
    return { id: u.id, name: u.display_name || u.login, login: u.login }
  }
  const settings = (body: Record<string, unknown>, done: string): Promise<CommandResult> =>
    helix('PATCH', '/chat/settings', mod, body).then(() => ok(done))

  switch (name) {
    case 'raid': {
      const raid = await startRaid(helix, me, rest[0] ?? '')
      return { ok: true, raid, message: `Raiding ${raid.name} when Twitch's countdown ends.` }
    }
    case 'unraid':
      await helix('DELETE', '/raids', { broadcaster_id: me })
      return { ok: true, raid: null, message: 'Raid canceled.' }
    case 'ban': {
      const u = await user(rest[0])
      await helix('POST', '/moderation/bans', mod, { data: { user_id: u.id, ...(rest.length > 1 ? { reason: rest.slice(1).join(' ') } : {}) } })
      return ok(`${u.name} is banned.`)
    }
    case 'unban':
    case 'untimeout': {
      const u = await user(rest[0])
      await helix('DELETE', '/moderation/bans', { ...mod, user_id: u.id })
      return ok(name === 'unban' ? `${u.name} is unbanned.` : `${u.name}'s timeout is removed.`)
    }
    case 'timeout': {
      const u = await user(rest[0])
      const d = rest[1] ? parseDuration(rest[1]) : 600
      if (!d || d < 1 || d > 1209600) return fail('Timeouts last from 1 second to 2 weeks, like /timeout name 10m reason.')
      const reason = rest.slice(rest[1] && parseDuration(rest[1]) ? 2 : 1).join(' ')
      await helix('POST', '/moderation/bans', mod, { data: { user_id: u.id, duration: d, ...(reason ? { reason } : {}) } })
      return ok(`${u.name} is timed out for ${say(d)}.`)
    }
    case 'warn': {
      const u = await user(rest[0])
      const reason = rest.slice(1).join(' ')
      if (!reason) return fail('Add a reason, like /warn name please keep it friendly.')
      await helix('POST', '/moderation/warnings', mod, { data: { user_id: u.id, reason } })
      return ok(`${u.name} is warned.`)
    }
    case 'slow': {
      const d = arg ? parseDuration(arg) : 30
      if (!d || d < 3 || d > 120) return fail('Slow mode waits 3 to 120 seconds, like /slow 30.')
      return settings({ slow_mode: true, slow_mode_wait_time: d }, `Slow mode on: ${say(d)} between messages.`)
    }
    case 'slowoff': return settings({ slow_mode: false }, 'Slow mode off.')
    case 'followers': {
      const d = arg ? parseDuration(arg, 'm') : 0
      if (d === null || d > 7776000) return fail('Followers-only can require up to 3 months of following, like /followers 10m.')
      return settings({ follower_mode: true, follower_mode_duration: Math.round(d / 60) }, d ? `Followers-only on: followed for ${say(d)}.` : 'Followers-only on.')
    }
    case 'followersoff': return settings({ follower_mode: false }, 'Followers-only off.')
    case 'subscribers': return settings({ subscriber_mode: true }, 'Subscribers-only on.')
    case 'subscribersoff': return settings({ subscriber_mode: false }, 'Subscribers-only off.')
    case 'emoteonly': return settings({ emote_mode: true }, 'Emote-only on.')
    case 'emoteonlyoff': return settings({ emote_mode: false }, 'Emote-only off.')
    case 'uniquechat': return settings({ unique_chat_mode: true }, 'Unique chat on.')
    case 'uniquechatoff': return settings({ unique_chat_mode: false }, 'Unique chat off.')
    case 'clear':
      await helix('DELETE', '/moderation/chat', mod)
      return ok('Chat cleared for everyone.')
    case 'announce': case 'announceblue': case 'announcegreen': case 'announceorange': case 'announcepurple': {
      if (!arg) return fail('Add the announcement, like /announce Stream starts in 5 minutes!')
      const color = name === 'announce' ? 'primary' : name.slice('announce'.length)
      await helix('POST', '/chat/announcements', mod, { message: arg.slice(0, 500), color })
      return ok('Announcement sent.')
    }
    case 'shoutout': case 'so': {
      const u = await user(rest[0])
      await helix('POST', '/chat/shoutouts', { from_broadcaster_id: me, to_broadcaster_id: u.id, moderator_id: me })
      return ok(`Shoutout sent to ${u.name}.`)
    }
    case 'commercial': {
      const length = arg ? parseDuration(arg) : 30
      if (!length || length > 180) return fail('Ads last up to 180 seconds, like /commercial 60.')
      const r = await helix('POST', '/channels/commercial', undefined, { broadcaster_id: me, length })
      const next = r?.data?.[0]?.retry_after
      return ok(`Ad break started (${say(r?.data?.[0]?.length ?? length)}).${next ? ` Next one possible in ${say(next)}.` : ''}`)
    }
    case 'marker':
      await helix('POST', '/streams/markers', undefined, { user_id: me, ...(arg ? { description: arg.slice(0, 140) } : {}) })
      return ok('Stream marker added.')
    case 'mod': case 'unmod': {
      const u = await user(rest[0])
      await helix(name === 'mod' ? 'POST' : 'DELETE', '/moderation/moderators', { broadcaster_id: me, user_id: u.id })
      return ok(name === 'mod' ? `${u.name} is now a moderator.` : `${u.name} is no longer a moderator.`)
    }
    case 'vip': case 'unvip': {
      const u = await user(rest[0])
      await helix(name === 'vip' ? 'POST' : 'DELETE', '/channels/vips', { broadcaster_id: me, user_id: u.id })
      return ok(name === 'vip' ? `${u.name} is now a VIP.` : `${u.name} is no longer a VIP.`)
    }
    case 'mods': case 'vips': {
      const r = await helix('GET', name === 'mods' ? '/moderation/moderators' : '/channels/vips', { broadcaster_id: me, first: '100' })
      const list = (r?.data ?? []).map((x: any) => x.user_name)
      return ok(list.length ? `${name === 'mods' ? 'Moderators' : 'VIPs'} (${list.length}): ${list.join(', ')}` : `No ${name === 'mods' ? 'moderators' : 'VIPs'} yet.`)
    }
    case 'shield': case 'shieldoff':
      await helix('PUT', '/moderation/shield_mode', mod, { is_active: name === 'shield' })
      return ok(name === 'shield' ? 'Shield mode on.' : 'Shield mode off.')
    case 'color': {
      if (!arg) return fail('Add a colour, like /color blue_violet or /color #9146FF (hex needs Turbo or Prime).')
      await helix('PUT', '/chat/color', { user_id: me, color: arg.trim() })
      return ok(`Your name colour is now ${arg.trim()}.`)
    }
    case 'title': {
      if (!arg) return fail('Add the new title, like /title Ranked grind!')
      await helix('PATCH', '/channels', { broadcaster_id: me }, { title: arg.slice(0, 140) })
      return ok('Stream title changed.')
    }
    case 'game': case 'category': {
      if (!arg) return fail('Add the game, like /game Just Chatting.')
      const r = await helix('GET', '/search/categories', { query: arg, first: '5' })
      const hit = (r?.data ?? []).find((c: any) => c.name.toLowerCase() === arg.toLowerCase()) ?? r?.data?.[0]
      if (!hit) return fail(`Twitch has no category matching "${arg}".`)
      await helix('PATCH', '/channels', { broadcaster_id: me }, { game_id: hit.id })
      return ok(`Category changed to ${hit.name}.`)
    }
    case 'block': case 'unblock': {
      const u = await user(rest[0])
      await helix(name === 'block' ? 'PUT' : 'DELETE', '/users/blocks', { target_user_id: u.id })
      return ok(name === 'block' ? `${u.name} is blocked.` : `${u.name} is unblocked.`)
    }
    case 'w': case 'whisper': {
      const u = await user(rest[0])
      const text = rest.slice(1).join(' ')
      if (!text) return fail('Add the message, like /w name hello!')
      await helix('POST', '/whispers', { from_user_id: me, to_user_id: u.id }, { message: text })
      return ok(`Whisper sent to ${u.name}.`)
    }
    case 'user': {
      const u = await user(rest[0])
      return { ok: true, openUser: { id: u.id, name: u.name, login: u.login } }
    }
    case 'pin': {
      // "/pin message" pins until the stream ends; "/pin 5m message" for 30 seconds to 30 minutes.
      // The time needs its unit (30s, 5m), so a message starting with a number stays a message.
      const d = /^\d+(s|m|h)$/i.test(rest[0] ?? '') ? parseDuration(rest[0]) : null
      const text = (d ? rest.slice(1) : rest).join(' ')
      if (!text) return fail('Add the message, like /pin Welcome! or /pin 10m Giveaway at 9pm.')
      if (d !== null && (d < 30 || d > 1800)) return fail('Pins last from 30 seconds to 30 minutes, or leave the time out to keep it until the stream ends.')
      const id = await send(text)
      if (!id) return fail('The message was sent, but Twitch gave no ID to pin it.')
      await helix('PUT', '/chat/pins', { ...mod, message_id: id, ...(d ? { duration_seconds: String(d) } : {}) })
      return { ok: true, pinned: true, message: d ? `Pinned for ${say(d)}.` : 'Pinned until the stream ends.' }
    }
    case 'pinmessage': {
      if (!rest[0]) return fail('No message to pin.')
      await helix('PUT', '/chat/pins', { ...mod, message_id: rest[0] })
      return { ok: true, pinned: true, message: 'Pinned until the stream ends.' }
    }
    case 'unpin': {
      const current = (await helix('GET', '/chat/pins', mod))?.data?.[0]
      if (!current) return ok('Nothing is pinned.')
      await helix('DELETE', '/chat/pins', { ...mod, message_id: current.message_id ?? current.id })
      return { ok: true, pinned: true, message: 'Unpinned.' }
    }
    case 'poll': {
      // /poll Question | Option A | Option B [| 2m]
      const parts = arg.split('|').map((p) => p.trim()).filter(Boolean)
      const last = parts.length > 3 ? parseDuration(parts.at(-1), 's') : null
      const options = last ? parts.slice(1, -1) : parts.slice(1)
      if (!parts[0] || options.length < 2 || options.length > 5) return fail('Use /poll Question | Option A | Option B (2 to 5 options), and optionally | 2m for the length.')
      await helix('POST', '/polls', undefined, { broadcaster_id: me, title: parts[0].slice(0, 60), choices: options.map((t) => ({ title: t.slice(0, 25) })), duration: Math.min(1800, Math.max(15, last ?? 120)) })
      return ok('Poll started.')
    }
    case 'endpoll': {
      const p = (await helix('GET', '/polls', { broadcaster_id: me, first: '1' }))?.data?.[0]
      if (!p || p.status !== 'ACTIVE') return ok('No poll is running.')
      await helix('PATCH', '/polls', undefined, { broadcaster_id: me, id: p.id, status: 'TERMINATED' })
      return ok('Poll ended.')
    }
    case 'prediction': {
      // /prediction Question | Outcome A | Outcome B [| 2m]
      const parts = arg.split('|').map((p) => p.trim()).filter(Boolean)
      const last = parts.length > 3 ? parseDuration(parts.at(-1), 's') : null
      const outcomes = last ? parts.slice(1, -1) : parts.slice(1)
      if (!parts[0] || outcomes.length < 2 || outcomes.length > 10) return fail('Use /prediction Question | Outcome A | Outcome B (2 to 10 outcomes), and optionally | 2m for the voting time.')
      await helix('POST', '/predictions', undefined, { broadcaster_id: me, title: parts[0].slice(0, 45), outcomes: outcomes.map((t) => ({ title: t.slice(0, 25) })), prediction_window: Math.min(1800, Math.max(30, last ?? 120)) })
      return ok('Prediction started.')
    }
    default:
      return null
  }
}

