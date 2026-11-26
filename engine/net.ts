import { core, type Reply, type Service } from './core'

export class HttpError extends Error {
  constructor(public status: number, message: string, public body?: unknown) {
    super(message)
  }
}

/** Digs the most readable message out of the various error shapes these APIs return. */
export function errorText(body: unknown, fallback: string): string {
  if (body && typeof body === 'object') {
    const b = body as Record<string, any>
    const text = b.message || b.error?.message || b.error_description || (typeof b.error === 'string' ? b.error : '') || fallback
    // OAuth servers like to put the useful part in a separate hint field
    return typeof b.hint === 'string' && b.hint ? `${text} ${b.hint}` : text
  }
  return typeof body === 'string' && body ? body.slice(0, 200) : fallback
}

function parse(text: string): any {
  if (!text) return undefined
  try {
    return JSON.parse(text)
  } catch {
    return text
  }
}

function settle(r: Reply, label: string): any {
  const body = parse(r.body)
  if (r.status < 200 || r.status >= 300) throw new HttpError(r.status, errorText(body, `${label} error ${r.status}`), body)
  return body
}

const asText = (body: unknown): string | undefined => (body === undefined ? undefined : typeof body === 'string' ? body : JSON.stringify(body))

/**
 * Unauthenticated request through Rust, which isn't bound by the webview's CORS rules. `init` only
 * supports the fetch options the connectors actually use.
 */
export async function fetchJson(url: string, init?: { method?: string; headers?: Record<string, string>; body?: string }): Promise<any> {
  return settle(await core.fetch(init?.method ?? 'GET', url, init?.headers, init?.body), 'HTTP')
}

/** Authenticated request as the user. JSON bodies get sent as JSON. */
export async function api(service: Service, method: string, url: string, body?: unknown, headers: Record<string, string> = {}): Promise<any> {
  const text = asText(body)
  const h = text !== undefined && typeof body !== 'string' ? { 'Content-Type': 'application/json', ...headers } : headers
  return settle(await core.api(service, method, url, h, text), service)
}

export function message(err: unknown): string {
  return err instanceof Error ? err.message : String(err)
}

export const sleep = (ms: number): Promise<void> => new Promise((r) => setTimeout(r, ms))

/** Reconnect delay for attempt n: exponential, capped at 60s, with jitter. */
export function backoff(attempt: number): number {
  return Math.min(60000, 1000 * 2 ** Math.min(attempt, 6)) * (0.75 + Math.random() * 0.5)
}
