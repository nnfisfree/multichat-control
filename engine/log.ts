import { core } from './core'

/**
 * Engine log. Lines are sent to Rust, which writes them to user-data/logs/app.log next to its own.
 * Statuses and errors only. Never log tokens, keys or chat.
 */
export function log(scope: string, text: string): void {
  void core.log(scope, text)
}
