export class HttpError extends Error {
  constructor(public status: number, message: string, public body?: unknown) {
    super(message)
  }
}

/** Pulls the most human-readable message out of the error shapes these APIs use. */
export function errorText(body: unknown, fallback: string): string {
  if (body && typeof body === 'object') {
    const b = body as Record<string, any>
    return b.message || b.error?.message || b.error_description || (typeof b.error === 'string' ? b.error : '') || fallback
  }
  return typeof body === 'string' && body ? body.slice(0, 200) : fallback
}

export async function readBody(res: Response): Promise<any> {
  const text = await res.text()
  if (!text) return undefined
  try {
    return JSON.parse(text)
  } catch {
    return text
  }
}

export async function fetchJson(url: string, init?: RequestInit): Promise<any> {
  const res = await fetch(url, { ...init, signal: init?.signal ?? AbortSignal.timeout(15000) })
  const body = await readBody(res)
  if (!res.ok) throw new HttpError(res.status, errorText(body, `HTTP ${res.status}`), body)
  return body
}

export function message(err: unknown): string {
  return err instanceof Error ? err.message : String(err)
}

export const sleep = (ms: number): Promise<void> => new Promise((r) => setTimeout(r, ms))

/** Delay for reconnect attempt n: exponential, capped at 60s, jittered to spread retries. */
export function backoff(attempt: number): number {
  return Math.min(60000, 1000 * 2 ** Math.min(attempt, 6)) * (0.75 + Math.random() * 0.5)
}
