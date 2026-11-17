import bundled from './supporters.json'
import { safeMessage, safeName } from './moderation'

/**
 * People who supported the project, shown on the Support page.
 *
 * shared/supporters.json is rebuilt from Buy Me a Coffee by a GitHub Action every 30 minutes
 * (scripts/update-supporters.mjs), merged with the hand-added people in supporters-manual.json.
 * The app ships with a copy and reads the latest one from GitHub when the Support page opens, so new
 * supporters show up without a release. BMC doesn't share profile pictures, so `avatar` comes from
 * supporters-manual.json; without one a coloured initials badge shows instead.
 */
export interface Supporter {
  name: string
  avatar?: string
  /** Total given, in `currency`. */
  amount: number
  currency: string
  /** Their profile, opened when the card is clicked. */
  url?: string
  /** Optional note they left with the donation. */
  message?: string
  /** Optional short tagline under their name (who they are), set in supporters-manual.json. */
  title?: string
}

export const SUPPORTERS_URL = 'https://raw.githubusercontent.com/nnfisfree/multichat-control/main/shared/supporters.json'

const https = (v: unknown): string | undefined => {
  if (typeof v !== 'string') return undefined
  try {
    return new URL(v).protocol === 'https:' ? v : undefined
  } catch {
    return undefined
  }
}
const text = (v: unknown, max: number): string | undefined => (typeof v === 'string' && v.trim() ? v.trim().slice(0, max) : undefined)

/**
 * Checks a downloaded list before it's shown: only known fields, https links only, sane lengths.
 * Anything off is dropped. Returns null if it isn't a list at all.
 */
export function cleanSupporters(raw: unknown): Supporter[] | null {
  if (!Array.isArray(raw)) return null
  const out: Supporter[] = []
  for (const r of raw.slice(0, 200)) {
    if (!r || typeof r !== 'object') continue
    const o = r as Record<string, unknown>
    // filtered again here, in case the file was edited by hand
    const name = o.name === undefined ? undefined : safeName(text(o.name, 40))
    const amount = Number(o.amount)
    const currency = typeof o.currency === 'string' && /^[A-Z]{3}$/.test(o.currency) ? o.currency : undefined
    if (!name || !Number.isFinite(amount) || amount < 0 || !currency) continue
    out.push({ name, amount, currency, avatar: https(o.avatar), url: https(o.url), message: safeMessage(text(o.message, 140)), title: safeMessage(text(o.title, 60)) })
  }
  return out
}

export const BUNDLED_SUPPORTERS: Supporter[] = cleanSupporters(bundled) ?? []
