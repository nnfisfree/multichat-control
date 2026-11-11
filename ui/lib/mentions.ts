import { plainText } from '../../shared/parts'
import type { ChatMessage } from '../../shared/types'

const patterns = new WeakMap<string[], RegExp | null>()
const escape = (s: string): string => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')

/** "@name" as a whole word, for any of the streamer's names, in any letter case. */
function pattern(names: string[]): RegExp | null {
  if (!patterns.has(names)) {
    const list = [...new Set(names.map((n) => n.trim()).filter(Boolean))].sort((a, b) => b.length - a.length).map(escape)
    patterns.set(names, list.length ? new RegExp(`(?:^|[^\\p{L}\\p{N}_])@(?:${list.join('|')})(?![\\p{L}\\p{N}_])`, 'iu') : null)
  }
  return patterns.get(names) ?? null
}

/** True when a viewer tagged the streamer, e.g. "@nonamefound are you there?". The streamer's own messages never count. */
export function mentionsStreamer(m: ChatMessage, names: string[] | undefined): boolean {
  if (!names?.length || m.author.isBroadcaster || m.kind === 'system') return false
  return pattern(names)?.test(plainText(m.parts)) ?? false
}
