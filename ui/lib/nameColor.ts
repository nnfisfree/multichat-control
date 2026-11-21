import type { ChatMessage, NameRole, PlatformPrefs } from '../../shared/types'

export const NAME_ROLES: { role: NameRole; label: string; youtube?: string }[] = [
  { role: 'broadcaster', label: 'Broadcaster' },
  { role: 'mod', label: 'Moderators' },
  { role: 'vip', label: 'VIPs' },
  { role: 'member', label: 'Subscribers', youtube: 'Members' }
]

/** Highest role first, so a mod who is also a sub gets the mod colour. */
function roleOf(a: ChatMessage['author']): NameRole | undefined {
  if (a.isBroadcaster) return 'broadcaster'
  if (a.isMod) return 'mod'
  if (a.isVip) return 'vip'
  if (a.isMember) return 'member'
  return undefined
}

/** Same person, same colour, every time. Hue only, so it stays readable on every skin. */
function hashHue(key: string): number {
  let h = 2166136261
  for (let i = 0; i < key.length; i++) h = Math.imul(h ^ key.charCodeAt(i), 16777619)
  return (h >>> 0) % 360
}

/** The colour a name is drawn in, after the platform's username colour options. */
export function nameColor(m: Pick<ChatMessage, 'platform' | 'author'>, prefs: PlatformPrefs | undefined): string | undefined {
  const role = roleOf(m.author)
  const byRole = role && prefs?.roleColors?.[role]
  if (byRole) return byRole
  switch (prefs?.nameColor) {
    case 'platform': return `var(--${m.platform})`
    case 'random': return `hsl(${hashHue(m.author.id || m.author.name)} 75% 66%)`
    case 'custom': return prefs.customColor || m.author.color
    default: return m.author.color
  }
}
