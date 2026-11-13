/**
 * The app's own check for the "buy followers" bots that visit small streams on every platform.
 * Kick and YouTube don't tell apps about such messages, so this looks at the text itself.
 *
 * A message counts only when it both offers followers, viewers or promotion AND points somewhere:
 * a link (also written as "site . com" or "site(.)com" to get past link filters) or "DM me".
 * So a viewer joking about buying followers is never marked.
 */

/** Something that points off the chat: a link, a disguised address, or an invitation to message. */
const POINTER = new RegExp([
  String.raw`https?:\/\/`,
  String.raw`\bwww\s*\.`,
  // site.com, site . com, site(.)com, site[.]com, site dot com
  String.raw`\b[a-z0-9-]+\s*(?:\.|\(\s*\.\s*\)|\[\s*\.\s*\]|\s+dot\s+)\s*(?:com|net|org|ru|xyz|shop|store|io|gg|pro|top|online|site|club|live|cc|me|biz|info|fun|space)\b`,
  String.raw`\b(?:dm|message|write|text)\s+me\b`,
  String.raw`\b(?:telegram|discord|whatsapp)\b`
].join('|'), 'i')

/** Offers to sell an audience: "buy followers", "cheap viewers", "best primes"... */
const OFFER = /\b(?:buy|cheap|best|get|boost|grow|promot\w*|increase|real|free|more)\b[^.!?\n]{0,40}?\b(?:follow(?:er)?s|viewers?|views|subs|subscribers|primes?|chatters?|viewbots?)\b/i

/** The usual pitches these bots open with. */
const PITCH = /\b(?:become famous|famous streamer|grow your (?:channel|stream)|boost your (?:channel|stream)|promote your (?:channel|stream)|view ?bots?|upgrade your stream)\b/i

/**
 * Undoes two tricks spam uses to dodge filters: styled letters (𝐛𝐮𝐲, ｂｕｙ) and invisible
 * characters. Words spaced out letter by letter are left alone on purpose: joining them back
 * would also catch normal chat.
 */
const normalise = (text: string): string => text.normalize('NFKC').replace(/[​-‏⁠﻿­]/g, '')

/** The reasons a message looks like follower spam, or null when it doesn't. */
export function spamReasons(text: string): string[] | null {
  const t = normalise(text)
  const offer = OFFER.test(t)
  const pitch = PITCH.test(t)
  if (!offer && !pitch) return null
  if (!POINTER.test(t)) return null
  return [offer ? 'Offers to sell followers or viewers' : 'Offers to promote the channel', 'Points to a site or asks to be messaged']
}
