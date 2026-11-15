/**
 * Our own check for the "buy followers" bots that hit small streams on every platform. Kick and
 * YouTube don't flag these for apps, so we look at the text ourselves.
 *
 * A message only counts if it offers followers/viewers/promotion AND points somewhere: a link
 * (including "site . com" or "site(.)com" tricks to dodge link filters) or "DM me". That way a
 * viewer joking about buying followers doesn't get flagged.
 */

// anything pointing off-chat: a link, a disguised address, or "message me"
const POINTER = new RegExp([
  String.raw`https?:\/\/`,
  String.raw`\bwww\s*\.`,
  // site.com, site . com, site(.)com, site[.]com, site dot com
  String.raw`\b[a-z0-9-]+\s*(?:\.|\(\s*\.\s*\)|\[\s*\.\s*\]|\s+dot\s+)\s*(?:com|net|org|ru|xyz|shop|store|io|gg|pro|top|online|site|club|live|cc|me|biz|info|fun|space)\b`,
  String.raw`\b(?:dm|message|write|text)\s+me\b`,
  String.raw`\b(?:telegram|discord|whatsapp)\b`
].join('|'), 'i')

// selling an audience: "buy followers", "cheap viewers", "best primes"...
const OFFER = /\b(?:buy|cheap|best|get|boost|grow|promot\w*|increase|real|free|more)\b[^.!?\n]{0,40}?\b(?:follow(?:er)?s|viewers?|views|subs|subscribers|primes?|chatters?|viewbots?)\b/i

// the usual opening lines these bots use
const PITCH = /\b(?:become famous|famous streamer|grow your (?:channel|stream)|boost your (?:channel|stream)|promote your (?:channel|stream)|view ?bots?|upgrade your stream)\b/i

/**
 * Undoes the two usual filter dodges: fancy unicode letters (𝐛𝐮𝐲, ｂｕｙ) and invisible
 * characters. Letter-by-letter spaced words are left alone on purpose, joining those back up would
 * flag normal chat too.
 */
const normalise = (text: string): string => text.normalize('NFKC').replace(/[​-‏⁠﻿­]/g, '')

/** Why the message looks like follower spam, or null if it doesn't. */
export function spamReasons(text: string): string[] | null {
  const t = normalise(text)
  const offer = OFFER.test(t)
  const pitch = PITCH.test(t)
  if (!offer && !pitch) return null
  if (!POINTER.test(t)) return null
  return [offer ? 'Offers to sell followers or viewers' : 'Offers to promote the channel', 'Points to a site or asks to be messaged']
}
