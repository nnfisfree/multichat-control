import type { StreamEvent } from '../../../shared/types'
import { giftEvent, tiktokEvent, type TikTokItem, type TikTokUser } from './normalize'

/** A streak with no update for this long counts as finished, in case its last message got lost. */
export const STREAK_IDLE_MS = 4000

/**
 * TikTok sends a streak gift (Rose, TikTok...) once per tap with a growing count, then once more
 * with `end`. We only report it once, when it's done, so the events list, pop-ups and alerts see
 * one "Rose ×25" instead of 25 Roses. Other gifts are reported right away.
 */
export class GiftStreaks {
  private open = new Map<string, { item: TikTokItem; timer: ReturnType<typeof setTimeout> }>()
  // finished streaks, so a late duplicate (e.g. replayed after a reconnect) doesn't count twice
  private done = new Set<string>()

  constructor(private emit: (e: StreamEvent) => void, private idleMs = STREAK_IDLE_MS) {}

  push(it: TikTokItem): void {
    if (it.kind !== 'gift' || !it.user) return
    const count = Math.max(1, Number(it.repeat) || 1)
    if (!it.streakable) {
      if (it.id) this.finish(it.id, it, count)
      return
    }
    const key = `${it.user.id ?? it.user.login}-${it.giftId}-${it.group}`
    if (this.done.has(key)) return
    const before = this.open.get(key)
    if (before) clearTimeout(before.timer)
    // counts only go up; an out-of-order older update must not shrink the streak
    const item = before && (Number(before.item.repeat) || 1) > count ? { ...it, repeat: before.item.repeat } : it
    if (it.end) {
      this.open.delete(key)
      this.finish(key, item, Math.max(1, Number(item.repeat) || 1))
      return
    }
    this.open.set(key, { item, timer: setTimeout(() => this.timeout(key), this.idleMs) })
  }

  private timeout(key: string): void {
    const s = this.open.get(key)
    if (!s) return
    this.open.delete(key)
    this.finish(key, s.item, Math.max(1, Number(s.item.repeat) || 1))
  }

  private finish(key: string, it: TikTokItem, count: number): void {
    if (this.done.has(key)) return
    this.done.add(key)
    if (this.done.size > 2000) this.done = new Set([...this.done].slice(-1000))
    this.emit(giftEvent({ key, ts: it.ts || Date.now(), user: it.user, name: it.name ?? '', image: it.image, diamonds: Math.max(0, Number(it.diamonds) || 0), count }))
  }

  /** Stream ended or we're stopping: report open streaks as they stand. */
  flush(): void {
    for (const key of [...this.open.keys()]) {
      const s = this.open.get(key)!
      clearTimeout(s.timer)
      this.timeout(key)
    }
  }

  clear(): void {
    for (const s of this.open.values()) clearTimeout(s.timer)
    this.open.clear()
  }
}

/**
 * Likes arrive constantly, so they never go into chat. Every interval, anyone who tapped a lot gets
 * one "sent 120 likes" line in the events list; the room total shows in the viewer stats.
 */
export class LikeTally {
  private byUser = new Map<string, { user: TikTokUser; n: number }>()
  total = 0

  constructor(private emit: (e: StreamEvent) => void, private min = 25) {}

  push(it: TikTokItem): void {
    if (it.kind !== 'like') return
    if (typeof it.total === 'number' && it.total > this.total) this.total = it.total
    if (!it.user?.id) return
    const t = this.byUser.get(it.user.id) ?? { user: it.user, n: 0 }
    t.n += Math.max(0, Number(it.count) || 0)
    this.byUser.set(it.user.id, t)
  }

  flush(): void {
    for (const { user, n } of this.byUser.values()) {
      if (n < this.min) continue
      this.emit(tiktokEvent({ type: 'other', actor: user.name || (user.login ? `@${user.login}` : 'Someone'), text: `sent ${n.toLocaleString('en-US')} likes` }))
    }
    this.byUser.clear()
  }

  reset(): void {
    this.byUser.clear()
    this.total = 0
  }
}
