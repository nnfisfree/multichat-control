/**
 * A light filter for names and messages shown publicly (the supporters wall). It isn't meant to be
 * perfect, just to keep the obvious stuff out: English and Italian swear words and slurs, also
 * when written with l33t letters, accents, s.p.a.c.e.s or reeepeated letters, plus links and spam.
 *
 * Plain TypeScript with no imports, so Node can run it straight from scripts/update-supporters.mjs.
 */

// l33t and look-alike characters, mapped back to letters
const LEET: Record<string, string> = { '0': 'o', '1': 'i', '2': 'z', '3': 'e', '4': 'a', '5': 's', '6': 'g', '7': 't', '8': 'b', '9': 'g', '@': 'a', '$': 's', '!': 'i', '|': 'i', '+': 't', '€': 'e', '£': 'l' }

/** Lowercase letters only, accents and l33t undone. Anything else becomes a space. */
function normalize(s: string): string {
  return s
    .normalize('NFKD')
    .replace(/[̀-ͯ]/g, '')
    .toLowerCase()
    .replace(/[0-9@$!|+€£]/g, (c) => LEET[c] ?? c)
    .replace(/[^a-z]+/g, ' ')
    .trim()
}
// "fuuuck" -> "fuck"; the lists below are squeezed the same way before comparing
const squeeze = (s: string): string => s.replace(/([a-z])\1+/g, '$1')

/**
 * Found anywhere, even inside other words or with the spaces taken out ("f u c k", "xXfuckXx").
 * Only long or distinctive enough that innocent words don't contain them.
 */
const ANYWHERE = [
  // English
  'fuck', 'fck', 'bullshit', 'shithead', 'bitch', 'bastard', 'asshole', 'arsehole', 'dickhead', 'cocksuck', 'motherf', 'wanker', 'whore',
  'slut', 'pussy', 'nigger', 'nigga', 'faggot', 'fagot', 'retard', 'tranny', 'rapist', 'hitler', 'porn', 'hentai', 'blowjob', 'handjob',
  'dildo', 'cumshot', 'jerkoff', 'spastic', 'killyourself',
  // Italian
  'cazzo', 'stronz', 'vaffancul', 'fancul', 'minchia', 'coglion', 'puttan', 'mignott', 'zoccol', 'merda', 'frocio', 'ricchion',
  'culattone', 'porcodio', 'diocane', 'dioporco', 'porcamadonna', 'diomerda', 'pompino', 'sborr', 'segaiol', 'leccaculo', 'handicappat',
  'mongoloid'
].map(squeeze)

/** Only as a whole word: short ones that would otherwise hit innocent names (Scunthorpe, Dickens...). */
const WORDS = new Set([
  'ass', 'arse', 'cunt', 'dick', 'cock', 'fag', 'fags', 'twat', 'tits', 'tit', 'cum', 'jizz', 'nazi', 'nazis', 'kkk', 'sex', 'sexy', 'anal',
  'piss', 'crap', 'damn', 'wtf', 'stfu', 'gtfo', 'milf', 'nsfw', 'xxx', 'figa', 'fica', 'culo', 'troia', 'troie', 'pene', 'tette', 'zoccola',
  'porco', 'porca', 'cesso', 'sega', 'seghe', 'vacca', 'idiota', 'scemo', 'deficiente', 'ritardato', 'shit', 'shits', 'shitty', 'rape',
  'raped', 'kys', 'heil', 'chink', 'negro', 'negra', 'frocia', 'terrone', 'terroni', 'cazzi', 'penis', 'vagina', 'boobs'
].map(squeeze))

// innocent words that happen to contain a blocked one once squeezed ("nigeria" -> "nigeria" holds "niger")
const ALLOWED = ['nigeria', 'nigerian', 'niger']

const SPAM = /(https?:\/\/|www\.|\.(com|net|org|io|gg|xyz|ru|tv|link|ly)\b|discord\.gg|t\.me\/|@[a-z0-9_]{3,})/i

/** True when the text has a swear word, slur, link or spam in it. */
export function isOffensive(text: string): boolean {
  if (SPAM.test(text)) return true
  const norm = normalize(text)
  if (!norm) return false
  const raw = norm.split(' ')
  if (raw.some((w) => WORDS.has(squeeze(w)))) return true
  // then with the spaces taken out ("f u c k"), skipping allowed words as written (not squeezed,
  // so "nigger" doesn't pass as "niger")
  const joined = squeeze(raw.filter((w) => !ALLOWED.includes(w)).join(''))
  return ANYWHERE.some((bad) => joined.includes(bad))
}

export const ANONYMOUS = 'Anonymous supporter'

/** The name to show: theirs, or "Anonymous supporter" if it's offensive or empty. */
export function safeName(name: string | undefined): string {
  const n = (name ?? '').replace(/\s+/g, ' ').trim().slice(0, 40)
  return n && !isOffensive(n) ? n : ANONYMOUS
}

/** The message to show, or nothing if it's offensive. */
export function safeMessage(message: string | undefined): string | undefined {
  const m = (message ?? '').replace(/\s+/g, ' ').trim().slice(0, 140)
  return m && !isOffensive(m) ? m : undefined
}
