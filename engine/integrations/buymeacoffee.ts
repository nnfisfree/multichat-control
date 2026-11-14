import { core } from '../core'
import { api, HttpError, message } from '../net'
import { money, text, type AlertContext, type AlertService } from './alerts'

const API = 'https://developers.buymeacoffee.com/api/v1'
const STATE_FILE = 'bmc-state.json'

/** New tips are looked for this often. Memberships and shop purchases change less often. */
const TIPS_EVERY = 15_000
const SUBS_EVERY = 60_000
/** Every member's renewal date is checked this often (all pages; page 1 is checked every minute). */
const FULL_SCAN_EVERY = 5 * 60_000
/** At most this many pages of a list are read in one go. */
const MAX_PAGES = 40
const MAX_SEEN = 3000

/** One membership or monthly donation, as last seen. */
interface SubState {
  /** When its current paid period started (ms). It moves forward when the supporter renews. */
  periodStart: number
  /** Paid months on this subscription so far. */
  months: number
  active: boolean
  /** Who it belongs to (a hash, never the email itself), so months add up across re-joins. */
  who: string
}

interface BmcState {
  /** False until the first full look: what's found then is history, not news. */
  synced: boolean
  tips: string[]
  extras: string[]
  subs: Record<string, SubState>
}

const emptyState = (): BmcState => ({ synced: false, tips: [], extras: [], subs: {} })

/** The first value that's present, so both the REST names and the webhook names are understood. */
function pick(o: any, ...keys: string[]): any {
  for (const k of keys) if (o?.[k] !== undefined && o?.[k] !== null && o?.[k] !== '') return o[k]
  return undefined
}

/**
 * BMC dates come as "2026-11-14 18:03:11" (UTC), as ISO text, or as Unix seconds.
 * Returns ms, or 0 when there's no usable date.
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
 * Billing months from a to b, rounded. Billing dates drift: a membership started on Jan 31 renews
 * on Feb 28, and renewals can land hours or a day off, so calendar days can't be compared exactly.
 */
export function monthsBetween(a: number, b: number): number {
  if (!a || !b || b <= a) return 0
  return Math.round((b - a) / (30.436875 * 86_400_000))
}

const isYearly = (s: any): boolean => /year|annual/i.test(String(pick(s, 'subscription_duration_type', 'duration_type') ?? ''))
const periodMonths = (s: any): number => (isYearly(s) ? 12 : 1)

/**
 * Paid months on a subscription seen for the first time: every period from its start to the one
 * running now. Pauses can't be seen in the list, so the start-to-now count is used; from then on
 * each renewal adds exactly one period.
 */
export function monthsSoFar(s: any): number {
  const started = bmcTime(pick(s, 'subscription_created_on', 'started_at'))
  const period = bmcTime(pick(s, 'subscription_current_period_start', 'current_period_start'))
  const step = periodMonths(s)
  if (!started || !period) return step
  return Math.floor(monthsBetween(started, period) / step) * step + step
}

/** A short, stable stand-in for a supporter, so no email is ever saved. */
async function hashOf(v: string): Promise<string> {
  const bytes = new Uint8Array(await crypto.subtle.digest('SHA-256', new TextEncoder().encode(v.trim().toLowerCase())))
  return Array.from(bytes.slice(0, 8), (b) => b.toString(16).padStart(2, '0')).join('')
}

const isPublic = (v: unknown): boolean => !(v === 0 || v === '0' || v === false || v === 'false' || v === 2 || v === '2')
const truthy = (v: unknown): boolean => v === true || v === 1 || v === '1' || v === 'true'

/**
 * Buy Me a Coffee has no live socket for apps and no OAuth: the streamer pastes a read-only
 * token, and its API is checked every few seconds. Tips, memberships (with every renewal, and
 * the total months a supporter has paid) and shop purchases all come through.
 */
export class BuyMeACoffee implements AlertService {
  readonly source = 'buymeacoffee' as const
  private run = 0
  private timer: ReturnType<typeof setTimeout> | null = null
  private state: BmcState = emptyState()
  private lastSubs = 0
  private lastFullScan = 0
  private failures = 0
  /** Whether this session's first look is done: after that, anything new is live. */
  private warm = false

  constructor(private ctx: AlertContext, private demo = false) {}

  private get(path: string): Promise<any> {
    return api('buymeacoffee', 'GET', API + path, undefined, { Accept: 'application/json' })
  }

  /** Every page of a list, newest first. `stop` ends early once an item is already known. */
  private async list(path: string, stop?: (item: any) => boolean, maxPages = MAX_PAGES): Promise<any[]> {
    const out: any[] = []
    for (let page = 1; page <= maxPages; page++) {
      const sep = path.includes('?') ? '&' : '?'
      let r: any
      try {
        r = await this.get(`${path}${sep}page=${page}`)
      } catch (err) {
        // BMC answers 404 when a list is empty (no supporters or members yet).
        if (err instanceof HttpError && err.status === 404) break
        throw err
      }
      const items: any[] = Array.isArray(r?.data) ? r.data : Array.isArray(r) ? r : []
      out.push(...items)
      if (!items.length || !r?.next_page_url || (stop && items.some(stop))) break
    }
    return out
  }

  /** Buy Me a Coffee logs in with a pasted token, never through the browser. */
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
    // A new token may belong to another page: start its history fresh.
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

  /** One round of checks, then the next one is planned. Rounds never overlap. */
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
      this.ctx.status({ status: 'connected', account: 'Buy Me a Coffee' })
      this.next(run, TIPS_EVERY)
    } catch (err) {
      if (run !== this.run) return
      if (err instanceof HttpError && (err.status === 401 || err.status === 403)) {
        void core.logout('buymeacoffee')
        return this.ctx.status({ status: 'needs-login', detail: "Buy Me a Coffee didn't accept the token any more. Connect again with a new one." })
      }
      // Busy (429) or down: wait longer each time, from 30 s up to 5 minutes.
      const wait = Math.min(5 * 60_000, 30_000 * 2 ** Math.min(this.failures++, 4))
      this.ctx.status({ status: 'reconnecting', account: 'Buy Me a Coffee', detail: message(err) })
      this.next(run, wait)
    }
  }

  private next(run: number, ms: number): void {
    if (run !== this.run) return
    this.timer = setTimeout(() => void this.poll(run), ms)
  }

  /**
   * Whether something just found should be a chat card. On a session's first look only the
   * last 10 minutes count; after that everything new is live. The very first connect shows
   * nothing as live, so years of supporters don't flood chat.
   */
  private live(ts: number): boolean {
    if (!this.state.synced) return false
    if (this.warm) return true
    return ts > 0 && Date.now() - ts < 10 * 60_000
  }

  // ---- One-time tips ----

  private async tips(): Promise<boolean> {
    const seen = new Set(this.state.tips)
    const known = (t: any): boolean => seen.has(String(pick(t, 'support_id', 'id')))
    // Only the newest pages: once a known tip shows up, everything older is known too.
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
        actor: text(pick(t, 'supporter_name', 'payer_name')) ?? 'Someone',
        text: coffees === 1 ? 'bought a coffee' : `bought ${coffees} coffees`,
        amount: money(total, pick(t, 'support_currency', 'currency')),
        message: isPublic(pick(t, 'support_visibility')) && !truthy(pick(t, 'note_hidden')) ? text(t?.support_note) : undefined,
        big: total >= 50, details: { Coffees: String(coffees) }
      })
    }
    return changed
  }

  // ---- Memberships and monthly donations ----

  private async subscriptions(full: boolean): Promise<boolean> {
    const items = await this.list('/subscriptions?status=all', undefined, full ? MAX_PAGES : 1)
    // Ids are numbers on BMC, newest last once reversed, so renewals count in the right order.
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
        // Older members found on the very first look are listed quietly, once, with their total.
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
        // Cancelled or paused: noted, but no card, as with the platforms' unsubscribes.
        before.active = active
        changed = true
      }
    }
    return changed
  }

  /** Months this supporter has paid in total, over every membership they've had here. */
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
      actor: text(pick(s, 'payer_name', 'supporter_name')) ?? 'Someone', text: text_,
      amount: level ?? (amount ? `${amount}/${per}` : undefined),
      message: isPublic(pick(s, 'message_visibility')) ? text(pick(s, 'subscription_message', 'supporter_feedback')) : undefined,
      big: renewal && total >= 12 && total % 12 === 0,
      details: {
        ...(level ? { Level: level } : {}),
        'Total months': String(total),
        Plan: per === 'year' ? 'Yearly' : 'Monthly',
        ...(amount ? { Amount: `${amount}/${per}` } : {}),
        ...(started ? { 'Supporting since': new Date(started).toLocaleDateString() } : {})
      }
    })
  }

  // ---- Shop purchases (Extras) ----

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
        history: !live || undefined, type: 'donation', actor: text(pick(x, 'payer_name', 'supporter_name')) ?? 'Someone',
        text: 'bought', subject: title, amount, big: Number(pick(x, 'purchase_amount', 'amount')) >= 50, details: {}
      })
    }
    return changed
  }
}
