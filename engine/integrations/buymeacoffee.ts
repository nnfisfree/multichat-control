import { plainNote } from '../../shared/events'
import { core } from '../core'
import { api, HttpError, message } from '../net'
import { money, text, type AlertContext, type AlertService } from './alerts'

const API = 'https://developers.buymeacoffee.com/api/v1'
const STATE_FILE = 'bmc-state.json'

// Tips get checked often; memberships and shop purchases change less, see below.
const TIPS_EVERY = 15_000
// a token is only treated as gone after this many 401/403 answers in a row
const REFUSALS_BEFORE_LOGOUT = 3
const SUBS_EVERY = 60_000
// Full scan of every member's renewal date. Page 1 alone is checked every minute.
const FULL_SCAN_EVERY = 5 * 60_000
// safety cap on pages per list
const MAX_PAGES = 40
const MAX_SEEN = 3000

/** A membership or monthly donation, as of the last check. */
interface SubState {
  /** Start of the current paid period (ms). Moves forward on renewal. */
  periodStart: number
  months: number
  active: boolean
  /** Hash of the supporter, never the email itself. Lets months add up if they leave and re-join. */
  who: string
}

interface BmcState {
  /** false until the first full scan. Whatever that finds is history, not news. */
  synced: boolean
  tips: string[]
  extras: string[]
  subs: Record<string, SubState>
}

const emptyState = (): BmcState => ({ synced: false, tips: [], extras: [], subs: {} })

// REST and webhook payloads use different field names; take the first one that's there.
function pick(o: any, ...keys: string[]): any {
  for (const k of keys) if (o?.[k] !== undefined && o?.[k] !== null && o?.[k] !== '') return o[k]
  return undefined
}

/**
 * BMC dates show up as "2026-11-14 18:03:11" (UTC), as ISO strings, or as unix seconds.
 * Returns ms, or 0 if there's nothing usable.
 */
export function bmcTime(v: unknown): number {
  if (typeof v === 'number') return v < 1e12 ? v * 1000 : v
  const s = typeof v === 'string' ? v.trim() : ''
  if (!s) return 0
  if (/^\d+$/.test(s)) return bmcTime(Number(s))
  const iso = /^\d{4}-\d{2}-\d{2} \d{2}:\d{2}(:\d{2})?$/.test(s) ? `${s.replace(' ', 'T')}Z` : s
  const t = Date.parse(iso)
  return Number.isFinite(t) ? t : 0
}

/**
 * Billing months between a and b, rounded. Billing dates drift (a membership started Jan 31 renews
 * Feb 28, and renewals can land hours or a day late), so exact calendar comparisons don't work.
 */
export function monthsBetween(a: number, b: number): number {
  if (!a || !b || b <= a) return 0
  return Math.round((b - a) / (30.436875 * 86_400_000))
}

const isYearly = (s: any): boolean => /year|annual/i.test(String(pick(s, 'subscription_duration_type', 'duration_type') ?? ''))
const periodMonths = (s: any): number => (isYearly(s) ? 12 : 1)

/**
 * Months paid on a subscription we're seeing for the first time: every period from its start until
 * now. Pauses aren't visible in the list, so this is a best guess. From here on each renewal adds
 * exactly one.
 */
export function monthsSoFar(s: any): number {
  const started = bmcTime(pick(s, 'subscription_created_on', 'started_at'))
  const period = bmcTime(pick(s, 'subscription_current_period_start', 'current_period_start'))
  const step = periodMonths(s)
  if (!started || !period) return step
  return Math.floor(monthsBetween(started, period) / step) * step + step
}

// short stable id for a supporter so we never have to store an email
async function hashOf(v: string): Promise<string> {
  const bytes = new Uint8Array(await crypto.subtle.digest('SHA-256', new TextEncoder().encode(v.trim().toLowerCase())))
  return Array.from(bytes.slice(0, 8), (b) => b.toString(16).padStart(2, '0')).join('')
}

const isPublic = (v: unknown): boolean => !(v === 0 || v === '0' || v === false || v === 'false' || v === 2 || v === '2')
const truthy = (v: unknown): boolean => v === true || v === 1 || v === '1' || v === 'true'

/**
 * BMC has no socket and no OAuth for apps. The streamer pastes a read-only token and we poll the
 * API every few seconds. Tips, memberships (every renewal, plus total months paid) and shop
 * purchases all come through here.
 */
export class BuyMeACoffee implements AlertService {
  readonly source = 'buymeacoffee' as const
  private run = 0
  private timer: ReturnType<typeof setTimeout> | null = null
  private state: BmcState = emptyState()
  private lastSubs = 0
  private lastFullScan = 0
  private failures = 0
  // 401/403 in a row; BMC's servers answer these during outages too, so one isn't proof
  private refused = 0
  // set after this session's first pass; anything new after that is live
  private warm = false

  constructor(private ctx: AlertContext, private demo = false) {}

  private get(path: string): Promise<any> {
    return api('buymeacoffee', 'GET', API + path, undefined, { Accept: 'application/json' })
  }

  /** Pages through a list, newest first. `stop` bails out once we hit an item we already know. */
  private async list(path: string, stop?: (item: any) => boolean, maxPages = MAX_PAGES): Promise<any[]> {
    const out: any[] = []
    for (let page = 1; page <= maxPages; page++) {
      const sep = path.includes('?') ? '&' : '?'
      let r: any
      try {
        r = await this.get(`${path}${sep}page=${page}`)
      } catch (err) {
        // BMC returns 404 for an empty list (no supporters/members yet)
        if (err instanceof HttpError && err.status === 404) break
        throw err
      }
      const items: any[] = Array.isArray(r?.data) ? r.data : Array.isArray(r) ? r : []
      out.push(...items)
      if (!items.length || !r?.next_page_url || (stop && items.some(stop))) break
    }
    return out
  }

  /** No browser login for BMC, it's always a pasted token. */
  async login(): Promise<void> {
    throw new Error('Paste your Buy Me a Coffee token in Settings to connect.')
  }

  async connect(token: string): Promise<void> {
    this.stop()
    this.ctx.status({ status: 'authorizing' })
    try {
      await core.setToken('buymeacoffee', token)
    } catch (err) {
      this.ctx.status({ status: 'needs-login', detail: message(err) })
      throw err
    }
    await this.start()
  }

  logout(): void {
    this.stop()
    void core.logout('buymeacoffee')
    // a new token might be for a different page, start its history from scratch
    this.state = emptyState()
    void core.removeFile(STATE_FILE).catch(() => {})
    this.ctx.status({ status: 'needs-login' })
  }

  async start(): Promise<void> {
    this.stop()
    const run = ++this.run
    if (this.demo) return this.ctx.status({ status: 'connected', account: 'Buy Me a Coffee' })
    const auth = await core.authState('buymeacoffee')
    if (run !== this.run) return
    if (!auth.loggedIn) return this.ctx.status({ status: 'needs-login' })
    this.ctx.status({ status: 'connecting' })
    this.state = await this.load()
    this.warm = false
    this.lastSubs = this.lastFullScan = 0
    await this.poll(run)
  }

  stop(): void {
    this.run++
    if (this.timer) clearTimeout(this.timer)
    this.timer = null
  }

  private async load(): Promise<BmcState> {
    try {
      const raw = await core.readFile(STATE_FILE)
      const s = raw ? JSON.parse(raw) : null
      if (s && typeof s === 'object') return { ...emptyState(), ...s, subs: s.subs && typeof s.subs === 'object' ? s.subs : {} }
    } catch { /* a broken file starts fresh */ }
    return emptyState()
  }

  private async save(): Promise<void> {
    this.state.tips = this.state.tips.slice(-MAX_SEEN)
    this.state.extras = this.state.extras.slice(-MAX_SEEN)
    await core.writeFile(STATE_FILE, JSON.stringify(this.state)).catch(() => {})
  }

  /** One round of checks, then schedules the next. Rounds never overlap. */
  private async poll(run: number): Promise<void> {
    try {
      const now = Date.now()
      let changed = await this.tips()
      if (run !== this.run) return
      if (!this.warm || now - this.lastSubs >= SUBS_EVERY) {
        const full = !this.warm || now - this.lastFullScan >= FULL_SCAN_EVERY
        changed = (await this.subscriptions(full)) || changed
        if (run !== this.run) return
        changed = (await this.extras()) || changed
        if (run !== this.run) return
        this.lastSubs = now
        if (full) this.lastFullScan = now
      }
      if (!this.state.synced) { this.state.synced = true; changed = true }
      if (changed) await this.save()
      this.warm = true
      this.failures = 0
      this.refused = 0
      this.ctx.status({ status: 'connected', account: 'Buy Me a Coffee' })
      this.next(run, TIPS_EVERY)
    } catch (err) {
      if (run !== this.run) return
      const refused = err instanceof HttpError && (err.status === 401 || err.status === 403)
      this.refused = refused ? this.refused + 1 : 0
      // Only a token refused again and again (minutes apart) is really gone. Even then it stays
      // saved, so pressing Reconnect is enough if BMC was just having a bad day.
      if (this.refused >= REFUSALS_BEFORE_LOGOUT) {
        return this.ctx.status({ status: 'error', account: 'Buy Me a Coffee', detail: "Buy Me a Coffee didn't accept the token several times in a row. Press Reconnect, or connect again with a new token." })
      }
      // One failed check (BMC's 502s) doesn't count as a disconnect: try again soon, quietly.
      // After that: back off, 30s doubling up to 5 min, and say so.
      if (this.failures++ === 0) return this.next(run, 15_000)
      const wait = Math.min(5 * 60_000, 30_000 * 2 ** Math.min(this.failures - 2, 4))
      this.ctx.status({ status: 'reconnecting', account: 'Buy Me a Coffee', detail: message(err) })
      this.next(run, wait)
    }
  }

  private next(run: number, ms: number): void {
    if (run !== this.run) return
    this.timer = setTimeout(() => void this.poll(run), ms)
  }

  /**
   * Should something we just found become a chat card? On a session's first pass only the last
   * 10 minutes count; after that everything new is live. The very first connect shows nothing as
   * live, otherwise years of supporters would flood chat.
   */
  private live(ts: number): boolean {
    if (!this.state.synced) return false
    if (this.warm) return true
    return ts > 0 && Date.now() - ts < 10 * 60_000
  }

  // --- one-time tips ---

  private async tips(): Promise<boolean> {
    const seen = new Set(this.state.tips)
    const known = (t: any): boolean => seen.has(String(pick(t, 'support_id', 'id')))
    // only the newest pages: once we hit a known tip, everything older is known too
    const items = await this.list('/supporters', this.state.synced ? known : undefined, this.state.synced ? 5 : MAX_PAGES)
    let changed = false
    for (const t of items.reverse()) {
      const id = String(pick(t, 'support_id', 'id') ?? '')
      if (!id || seen.has(id)) continue
      seen.add(id)
      this.state.tips.push(id)
      changed = true
      if (truthy(pick(t, 'is_refunded', 'refunded'))) continue
      const ts = bmcTime(pick(t, 'support_created_on', 'created_at'))
      const coffees = Number(pick(t, 'support_coffees', 'coffee_count')) || 1
      const price = Number(pick(t, 'support_coffee_price', 'coffee_price'))
      const total = Number(pick(t, 'amount')) || (Number.isFinite(price) ? coffees * price : NaN)
      const live = this.live(ts)
      this.ctx.event({
        id: `bmc-don-${id}`, platform: this.ctx.home(), ts: live ? Date.now() : ts || Date.now(), source: 'buymeacoffee',
        history: !live || undefined, type: 'donation',
        actor: plainNote(text(pick(t, 'supporter_name', 'payer_name'))) ?? 'Someone',
        text: coffees === 1 ? 'bought a coffee' : `bought ${coffees} coffees`,
        amount: money(total, pick(t, 'support_currency', 'currency')),
        message: isPublic(pick(t, 'support_visibility')) && !truthy(pick(t, 'note_hidden')) ? plainNote(text(t?.support_note), text(pick(t, 'supporter_name', 'payer_name'))) : undefined,
        big: total >= 50, details: { Coffees: String(coffees) }
      })
    }
    return changed
  }

  // --- memberships and monthly donations ---

  private async subscriptions(full: boolean): Promise<boolean> {
    const items = await this.list('/subscriptions?status=all', undefined, full ? MAX_PAGES : 1)
    // ids are numeric; reversed so renewals get counted in order
    let changed = false
    for (const s of items.reverse()) {
      const id = String(pick(s, 'subscription_id', 'id') ?? '')
      if (!id) continue
      const period = bmcTime(pick(s, 'subscription_current_period_start', 'current_period_start'))
      const active = !truthy(pick(s, 'subscription_is_cancelled', 'canceled')) && !pick(s, 'subscription_cancelled_on', 'canceled_at')
        && !truthy(pick(s, 'paused'))
      const before = this.state.subs[id]
      if (!before) {
        const email = text(pick(s, 'payer_email', 'supporter_email'))
        const who = email ? await hashOf(email) : `name:${(text(pick(s, 'payer_name', 'supporter_name')) ?? id).toLowerCase()}`
        const months = monthsSoFar(s)
        this.state.subs[id] = { periodStart: period, months, active, who }
        changed = true
        // members found on the very first pass get listed quietly, once, with their total
        if (active) this.emitSub(s, id, period, months, false, !this.live(bmcTime(pick(s, 'subscription_created_on', 'started_at'))))
        continue
      }
      if (period > before.periodStart) {
        before.periodStart = period
        before.months += periodMonths(s)
        before.active = active
        changed = true
        this.emitSub(s, id, period, before.months, true, !this.live(period))
      } else if (before.active !== active) {
        // cancelled/paused: remember it, but no card (same as unsubscribes on the platforms)
        before.active = active
        changed = true
      }
    }
    return changed
  }

  /** Total months across every membership this supporter has ever had here. */
  private totalMonths(who: string): number {
    let n = 0
    for (const s of Object.values(this.state.subs)) if (s.who === who) n += s.months
    return n
  }

  private emitSub(s: any, id: string, period: number, months: number, renewal: boolean, history: boolean): void {
    const mine = this.state.subs[id]
    const total = mine ? this.totalMonths(mine.who) : months
    const earlier = total > months
    const price = Number(pick(s, 'subscription_coffee_price', 'amount'))
    const count = Number(pick(s, 'subscription_coffee_num')) || 1
    const per = isYearly(s) ? 'year' : 'month'
    const amount = money(Number.isFinite(price) ? price * count : NaN, pick(s, 'subscription_currency', 'currency'))
    const level = text(pick(s, 'membership_level_name', 'level_name'))
    const started = bmcTime(pick(s, 'subscription_created_on', 'started_at'))
    const label = total > 1 ? ` (${total} months)` : ''
    const text_ = renewal ? `renewed their membership${label}`
      : earlier ? `is back as a member${label}`
      : history ? (total > 1 ? `is a member${label}` : 'is a member')
      : 'became a member'
    this.ctx.event({
      id: `bmc-sub-${id}-${period || 0}`, platform: this.ctx.home(), ts: history ? period || started || Date.now() : Date.now(),
      source: 'buymeacoffee', history: history || undefined, type: 'sub',
      actor: plainNote(text(pick(s, 'payer_name', 'supporter_name'))) ?? 'Someone', text: text_,
      amount: level ?? (amount ? `${amount}/${per}` : undefined),
      message: isPublic(pick(s, 'message_visibility')) ? plainNote(text(pick(s, 'subscription_message', 'supporter_feedback')), text(pick(s, 'payer_name', 'supporter_name'))) : undefined,
      big: renewal && total >= 12 && total % 12 === 0,
      months: total || undefined,
      details: {
        ...(level ? { Level: level } : {}),
        'Total months': String(total),
        Plan: per === 'year' ? 'Yearly' : 'Monthly',
        ...(amount ? { Amount: `${amount}/${per}` } : {}),
        ...(started ? { 'Supporting since': new Date(started).toLocaleDateString() } : {})
      }
    })
  }

  // --- shop purchases (Extras) ---

  private async extras(): Promise<boolean> {
    const seen = new Set(this.state.extras)
    const known = (x: any): boolean => seen.has(String(pick(x, 'purchase_id', 'id')))
    const items = await this.list('/extras', this.state.synced ? known : undefined, this.state.synced ? 3 : MAX_PAGES)
    let changed = false
    for (const x of items.reverse()) {
      const id = String(pick(x, 'purchase_id', 'id') ?? '')
      if (!id || seen.has(id)) continue
      seen.add(id)
      this.state.extras.push(id)
      changed = true
      if (truthy(pick(x, 'purchase_is_revoked', 'refunded'))) continue
      const ts = bmcTime(pick(x, 'purchased_on', 'created_at'))
      const live = this.live(ts)
      const title = text(x?.extra?.reward_title) ?? text(x?.extras?.[0]?.title) ?? 'an extra'
      const amount = money(pick(x, 'purchase_amount', 'amount'), pick(x, 'purchase_currency', 'currency'))
      this.ctx.event({
        id: `bmc-ext-${id}`, platform: this.ctx.home(), ts: live ? Date.now() : ts || Date.now(), source: 'buymeacoffee',
        history: !live || undefined, type: 'donation', actor: plainNote(text(pick(x, 'payer_name', 'supporter_name'))) ?? 'Someone',
        text: 'bought', subject: title, amount, big: Number(pick(x, 'purchase_amount', 'amount')) >= 50, details: {}
      })
    }
    return changed
  }
}
