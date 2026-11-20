import bundled from './supporters.json'
import { safeMessage, safeName } from './moderation'

/**
 * People who supported the project, shown on the Support page.
 *
 * shared/supporters.json is rebuilt by a GitHub Action every 30 minutes (scripts/update-supporters.mjs)
 * from supporters-manual.json: collaborators, plus Buy Me a Coffee supporters the owner approved by
 * listing them there. Anyone else on BMC (stream donations, trolls) never appears.
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
  /** 'github' = a GitHub Sponsor (gets a small GitHub mark on the card). */
  source?: 'github'
  /** Helped build the project: shown in its own Collaborators section. amount is 0 if they gave nothing. */
  collaborator?: boolean
  /** Collaborators: things they made, shown as "& creator of <project> <project>" with links (GitHub). */
  projects?: { name: string; url?: string }[]
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
    const extra = { avatar: https(o.avatar), url: https(o.url), title: safeMessage(text(o.title, 60)) }
    const amount = Number(o.amount)
    const currency = typeof o.currency === 'string' && /^[A-Z]{3}$/.test(o.currency) ? o.currency : undefined
    if (o.collaborator === true) {
      const gave = Number.isFinite(amount) && amount > 0 && !!currency
      const projects = (Array.isArray(o.projects) ? o.projects : []).slice(0, 6).flatMap((x: any) => {
        const n = safeMessage(text(x?.name, 40))
        return n ? [{ name: n, url: https(x?.url) }] : []
      })
      if (name) out.push({ name, amount: gave ? amount : 0, currency: gave ? currency! : 'EUR', collaborator: true, projects, ...extra })
      continue
    }
    if (!name || !Number.isFinite(amount) || amount < 0 || !currency) continue
    out.push({ name, amount, currency, message: safeMessage(text(o.message, 140)), source: o.source === 'github' ? 'github' : undefined, ...extra })
  }
  return out
}

export const BUNDLED_SUPPORTERS: Supporter[] = cleanSupporters(bundled) ?? []
