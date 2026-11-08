import { app } from 'electron'
import { appendFileSync, mkdirSync, renameSync, statSync } from 'node:fs'
import { join } from 'node:path'

const MAX_BYTES = 1_000_000

/** Long tokens never belong in a log, so anything that looks like one is blanked out. */
const redact = (text: string): string => text.replace(/[A-Za-z0-9_\-.]{28,}/g, '[hidden]')

/**
 * A small private log in the data folder, so connection problems can be diagnosed afterwards.
 * It holds statuses and error messages only: never tokens, keys or chat.
 */
export function log(scope: string, text: string): void {
  try {
    const dir = join(app.getPath('userData'), 'logs')
    const file = join(dir, 'app.log')
    mkdirSync(dir, { recursive: true })
    try {
      if (statSync(file).size > MAX_BYTES) renameSync(file, join(dir, 'app.old.log'))
    } catch { /* no log yet */ }
    appendFileSync(file, `${new Date().toISOString()} [${scope}] ${redact(text)}\n`)
  } catch {
    // Logging must never break the app.
  }
}
