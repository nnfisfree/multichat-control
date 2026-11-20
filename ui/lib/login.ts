import type { Platform } from '../../shared/types'
import { getState } from './store'

/** Opens the YouTube note (YoutubeNotice.tsx); `detail` says whether to go on to Google. */
export const YOUTUBE_NOTICE_EVENT = 'nnf:youtube-notice'
export type YoutubeNoticeDetail = (go: boolean) => void

/**
 * Every "Log in" button goes through here. Before the YouTube login, the app explains Google's
 * "Google hasn't verified this app" warning, which only appears with the app's built-in Google
 * client (people using their own Google app get their own screens).
 */
export function login(platform: Platform): Promise<unknown> {
  // TikTok has no login, just a username and key in Settings
  if (platform === 'tiktok') {
    window.dispatchEvent(new CustomEvent('nnf:open-settings', { detail: { cat: 'connections', target: 'tiktok-settings' } }))
    return Promise.resolve()
  }
  const { boot, settings } = getState()
  const builtIn = !!boot?.builtInYoutube && !settings?.youtubeClientId
  if (platform !== 'youtube' || !builtIn || settings?.youtubeNoticeSeen) return window.nnf.login(platform)
  return new Promise((resolve, reject) => {
    const answer: YoutubeNoticeDetail = (go) => (go ? window.nnf.login('youtube').then(resolve, reject) : resolve(undefined))
    window.dispatchEvent(new CustomEvent<YoutubeNoticeDetail>(YOUTUBE_NOTICE_EVENT, { detail: answer }))
  })
}
