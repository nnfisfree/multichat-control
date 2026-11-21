import { log } from '../../log'

/**
 * Counts what the app asks YouTube for, so app.log shows where the daily quota (10,000 units by
 * default) goes. Costs are Google's published ones for the Data API. The live chat gRPC stream has
 * no published cost, so it's counted separately (opens and batches) to compare against.
 */
const COST: Record<string, number> = {
  'GET /channels': 1,
  'GET /videos': 1,
  'GET /liveBroadcasts': 1,
  'GET /liveChat/messages': 5,
  'POST /liveChat/messages': 50,
  'DELETE /liveChat/messages': 50,
  'POST /liveChat/bans': 50
}

const REPORT_EVERY_MS = 30 * 60_000

interface Counts { calls: Map<string, number>; failed: number; opens: number; batches: number }
const empty = (): Counts => ({ calls: new Map(), failed: 0, opens: 0, batches: 0 })

// YouTube's quota day starts at midnight Pacific time
const quotaDay = (): string => new Date().toLocaleDateString('en-CA', { timeZone: 'America/Los_Angeles' })

function units(c: Counts): number {
  let n = 0
  for (const [k, v] of c.calls) n += (COST[k] ?? 1) * v
  return n
}

function describe(c: Counts): string {
  const calls = [...c.calls].sort((a, b) => (COST[b[0]] ?? 1) * b[1] - (COST[a[0]] ?? 1) * a[1])
    .map(([k, v]) => `${k} ×${v} (${(COST[k] ?? 1) * v})`)
  return [
    calls.length ? calls.join(', ') : 'no API calls',
    `chat stream: ${c.opens} opened, ${c.batches} batches`,
    c.failed ? `${c.failed} failed` : ''
  ].filter(Boolean).join(' · ')
}

class QuotaTally {
  private window = empty()
  private day = empty()
  private dayKey = quotaDay()
  private since = Date.now()
  private timer: ReturnType<typeof setInterval> | null = null
  private reportedOut = false

  private roll(): void {
    const key = quotaDay()
    if (key === this.dayKey) return
    this.report('end of the quota day')
    this.day = empty()
    this.dayKey = key
    this.reportedOut = false
  }

  private start(): void {
    this.timer ??= setInterval(() => this.report(), REPORT_EVERY_MS)
  }

  call(method: string, path: string): void {
    this.start()
    this.roll()
    const k = `${method} ${path}`
    for (const c of [this.window, this.day]) c.calls.set(k, (c.calls.get(k) ?? 0) + 1)
  }

  failed(quota: boolean): void {
    this.window.failed++
    this.day.failed++
    if (quota && !this.reportedOut) {
      this.reportedOut = true
      log('youtube', `quota used up. Today since the app started: ~${units(this.day)} units · ${describe(this.day)}`)
    }
  }

  streamOpened(): void {
    this.start()
    this.roll()
    this.window.opens++
    this.day.opens++
  }

  batch(): void {
    this.window.batches++
    this.day.batches++
  }

  /** Writes what happened since the last report, plus the running total for the quota day. */
  report(why?: string): void {
    const w = this.window
    if (!w.calls.size && !w.opens && !w.failed) return
    const mins = Math.round((Date.now() - this.since) / 60_000)
    log('youtube', `quota${why ? ` (${why})` : ''}, last ${mins} min: ~${units(w)} units · ${describe(w)} | today (Pacific day ${this.dayKey}): ~${units(this.day)} units, ${this.day.opens} stream opens, ${this.day.batches} batches`)
    this.window = empty()
    this.since = Date.now()
  }
}

export const quota = new QuotaTally()
