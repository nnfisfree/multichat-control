import { fetchJson, HttpError } from './net'

const API = 'https://api.pronouns.alejo.io/v1'
const CONCURRENCY = 4
const MAX_CACHE = 5000

export interface PronounDef { subject: string; object: string; singular: boolean }

/** Formats like the service itself does: "He/Him", "They/Them", or "Any" for single-word ones. */
export function formatPronoun(defs: Record<string, PronounDef>, id: string | null | undefined, alt?: string | null): string | null {
  const main = id ? defs[id] : undefined
  if (!main) return null
  const second = alt ? defs[alt] : undefined
  if (second) return `${main.subject}/${second.subject}`
  return main.singular ? main.subject : `${main.subject}/${main.object}`
}

/** Chatter pronouns from the community pronouns service most Twitch tools use. */
export class Pronouns {
  private defs: Promise<Record<string, PronounDef>> | null = null
  private known = new Map<string, string | null>()
  private queue: string[] = []
  private active = 0

  constructor(private found: (login: string, label: string) => void) {}

  private definitions(): Promise<Record<string, PronounDef>> {
    this.defs ??= fetchJson(`${API}/pronouns`).catch((err) => {
      this.defs = null
      throw err
    })
    return this.defs!
  }

  /** Each login gets asked about once, busy chats don't spam the service. */
  request(login: string): void {
    if (!login || this.known.has(login)) return
    if (this.known.size >= MAX_CACHE) this.known.delete(this.known.keys().next().value!)
    this.known.set(login, null)
    this.queue.push(login)
    this.pump()
  }

  private pump(): void {
    while (this.active < CONCURRENCY && this.queue.length) {
      const login = this.queue.shift()!
      this.active++
      void this.lookup(login).finally(() => {
        this.active--
        this.pump()
      })
    }
  }

  private async lookup(login: string): Promise<void> {
    try {
      const [defs, user] = await Promise.all([this.definitions(), fetchJson(`${API}/users/${encodeURIComponent(login)}`)])
      const label = formatPronoun(defs, user?.pronoun_id, user?.alt_pronoun_id)
      this.known.set(login, label)
      if (label) this.found(login, label)
    } catch (err) {
      // 404 = they never set any. Anything else might be temporary, so allow a retry later.
      if (!(err instanceof HttpError && err.status === 404)) this.known.delete(login)
    }
  }
}
