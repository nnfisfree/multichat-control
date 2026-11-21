import { chatEventGroup, standaloneSource } from './events'
import type { EventShow, EventType, Platform, Settings, StreamEvent } from './types'

/** Platforms with their own options in Settings > Chat. TikTok is read-only and keeps the defaults. */
export const PREF_PLATFORMS = ['twitch', 'youtube', 'kick'] as const
export type PrefPlatform = (typeof PREF_PLATFORMS)[number]

export interface EventRowInfo { type: EventType; label: string; desc?: string }

/** The kinds of events each platform really sends us, in the order Settings lists them. */
export const PLATFORM_EVENTS: Record<PrefPlatform, EventRowInfo[]> = {
  twitch: [
    { type: 'follow', label: 'Follows' },
    { type: 'sub', label: 'Subs and resubs' },
    { type: 'gift', label: 'Gift subs and gift bombs' },
    { type: 'cheer', label: 'Cheers and Bits badges', desc: 'Cheers already show as messages' },
    { type: 'redemption', label: 'Channel point rewards' },
    { type: 'powerup', label: 'Power-ups' },
    { type: 'raid', label: 'Raids' },
    { type: 'hypetrain', label: 'Hype Train', desc: 'The banner at the top always shows' },
    { type: 'poll', label: 'Polls' },
    { type: 'prediction', label: 'Predictions' },
    { type: 'goal', label: 'Goals' },
    { type: 'shoutout', label: 'Shoutouts' },
    { type: 'announcement', label: 'Announcements', desc: 'Already show as messages' },
    { type: 'paid', label: 'Charity donations' },
    { type: 'ad', label: 'Ad breaks' },
    { type: 'moderation', label: 'Moderation', desc: 'Bans, timeouts, mods and VIPs added or removed, chat modes' },
    { type: 'stream', label: 'Stream', desc: 'Going live or offline, title and category changes' }
  ],
  youtube: [
    { type: 'sub', label: 'New members and milestones' },
    { type: 'gift', label: 'Gifted memberships' },
    { type: 'paid', label: 'Super Chats and Super Stickers', desc: 'Super Chats already show as messages' },
    { type: 'moderation', label: 'Moderation', desc: 'Bans and timeouts' },
    { type: 'stream', label: 'Stream', desc: 'Going live or ending' }
  ],
  kick: [
    { type: 'follow', label: 'Follows' },
    { type: 'sub', label: 'Subs and resubs' },
    { type: 'gift', label: 'Gift subs' },
    { type: 'paid', label: 'KICKs' },
    { type: 'raid', label: 'Hosts' },
    { type: 'redemption', label: 'Channel point rewards' },
    { type: 'moderation', label: 'Moderation', desc: 'Bans and timeouts' },
    { type: 'stream', label: 'Stream', desc: 'Going live or offline, title and category changes' }
  ]
}

export const isPrefPlatform = (p: Platform): p is PrefPlatform => (PREF_PLATFORMS as readonly string[]).includes(p)

/** Out of the box: the kinds that always had chat cards get one, everything goes to the Events tab. */
export const defaultShow = (type: EventType): EventShow => ({ chat: !!chatEventGroup(type), feed: true })

/** Where events of this kind show on this platform, defaults plus what the user changed. */
export function eventShow(s: Pick<Settings, 'platformPrefs'>, platform: PrefPlatform, type: EventType): EventShow {
  return { ...defaultShow(type), ...s.platformPrefs?.[platform]?.events?.[type] }
}

/**
 * Whether an event shows in chat or in the Events tab (and its pop-ups). Tips from alert services and
 * TikTok keep using the general "Events in chat" switches.
 */
export function eventShown(s: Pick<Settings, 'platformPrefs' | 'chatEvents'>, e: Pick<StreamEvent, 'type' | 'platform' | 'source'>, where: keyof EventShow): boolean {
  if (standaloneSource(e) || !isPrefPlatform(e.platform)) {
    if (where === 'feed') return true
    const group = chatEventGroup(e.type)
    return !!group && (s.chatEvents[group] ?? true)
  }
  return eventShow(s, e.platform, e.type)[where]
}

/**
 * Whether an event shows in the Events tab right now: its kind is on for the Events tab in Settings,
 * and the tab's own platform and type filters let it through. Every event is still recorded, so
 * switching a kind back on shows the ones that came in meanwhile. The unread badge only counts these.
 */
export function inEventsTab(s: Pick<Settings, 'platformPrefs' | 'chatEvents' | 'eventFilter'>, e: Pick<StreamEvent, 'type' | 'platform' | 'source'>): boolean {
  const f = s.eventFilter
  return (!!standaloneSource(e) || f.platforms[e.platform] !== false) && !f.hiddenTypes.includes(e.type) && eventShown(s, e, 'feed')
}
