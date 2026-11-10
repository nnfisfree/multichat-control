import { core } from './core'

/**
 * The engine's log. Lines go to the core, which keeps them in user-data/logs/app.log next to its
 * own. It holds statuses and error messages only: never tokens, keys or chat.
 */
export function log(scope: string, text: string): void {
  void core.log(scope, text)
}
