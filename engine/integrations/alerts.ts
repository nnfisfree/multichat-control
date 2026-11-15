import type { AlertSource, IntegrationState, Platform, StreamEvent } from '../../shared/types'

/** What an alert integration gets from the hub. */
export interface AlertContext {
  event(e: StreamEvent): void
  status(s: Omit<IntegrationState, 'source'>): void
  /** Platform to file a donation under when the service doesn't say. */
  home(): Platform
}

export interface AlertService {
  readonly source: AlertSource
  start(): Promise<void>
  stop(): void
  login(): Promise<void>
  logout(): void
}

const PROVIDERS: Record<string, Platform> = {
  twitch: 'twitch', twitch_account: 'twitch',
  youtube: 'youtube', youtube_account: 'youtube',
  kick: 'kick', kick_account: 'kick'
}

export const toPlatform = (provider: unknown): Platform | undefined => PROVIDERS[String(provider ?? '').toLowerCase()]

/** "12.5" + "EUR" -> "€12.50", formatted for the user's locale. */
export function money(amount: unknown, currency: unknown): string | undefined {
  const n = Number(amount)
  if (!Number.isFinite(n) || amount === '' || amount == null) return undefined
  const code = String(currency ?? '').toUpperCase()
  if (!/^[A-Z]{3}$/.test(code)) return n.toFixed(2)
  try {
    return new Intl.NumberFormat(undefined, { style: 'currency', currency: code }).format(n)
  } catch {
    return `${n.toFixed(2)} ${code}`
  }
}

export function tier(plan: unknown): string | undefined {
  const p = String(plan ?? '').toLowerCase()
  if (p === 'prime') return 'Prime'
  if (p === '1000' || p === '1') return 'Tier 1'
  if (p === '2000' || p === '2') return 'Tier 2'
  if (p === '3000' || p === '3') return 'Tier 3'
  return undefined
}

export const text = (v: unknown): string | undefined => {
  const s = typeof v === 'string' ? v.trim() : ''
  return s || undefined
}
