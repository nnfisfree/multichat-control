import { store } from './store'

export interface AppCredentials { id: string; secret: string }

/**
 * Official builds can include a shared developer app, so users just log in. These values come
 * from a private `.env.local` at build time and are never in the source code.
 * Main-process only: the renderer bundle must not contain them.
 */
const BUILT_IN = {
  youtube: { id: import.meta.env.MAIN_VITE_YOUTUBE_CLIENT_ID ?? '', secret: import.meta.env.MAIN_VITE_YOUTUBE_CLIENT_SECRET ?? '' },
  kick: { id: import.meta.env.MAIN_VITE_KICK_CLIENT_ID ?? '', secret: import.meta.env.MAIN_VITE_KICK_CLIENT_SECRET ?? '' },
  streamelements: { id: import.meta.env.MAIN_VITE_STREAMELEMENTS_CLIENT_ID ?? '', secret: import.meta.env.MAIN_VITE_STREAMELEMENTS_CLIENT_SECRET ?? '' },
  streamlabs: { id: import.meta.env.MAIN_VITE_STREAMLABS_CLIENT_ID ?? '', secret: import.meta.env.MAIN_VITE_STREAMLABS_CLIENT_SECRET ?? '' }
}

/** Alert services only ever use the app's own built-in login. */
export function alertCredentials(source: 'streamelements' | 'streamlabs'): AppCredentials | null {
  const c = BUILT_IN[source]
  return c.id && c.secret ? c : null
}

export const hasBuiltIn = (platform: 'youtube' | 'kick'): boolean => !!(BUILT_IN[platform].id && BUILT_IN[platform].secret)

/** A user's own app takes priority, so they can opt out of the shared quota. */
export function credentials(platform: 'youtube' | 'kick'): AppCredentials | null {
  const id = platform === 'youtube' ? store.settings.youtubeClientId : store.settings.kickClientId
  const secret = store.getSecret(`${platform}.clientSecret`)
  if (id && secret) return { id, secret }
  return hasBuiltIn(platform) ? BUILT_IN[platform] : null
}
