import { invoke } from '@tauri-apps/api/core'
import { listen } from '@tauri-apps/api/event'
import type { SecretState } from '../shared/types'

/**
 * Every call the engine makes into Rust, in one place. Tokens never reach the webview: the engine
 * just names a service and Rust attaches the token.
 */
export type Service = 'twitch' | 'kick' | 'youtube' | 'streamelements' | 'streamlabs' | 'buymeacoffee'

export interface Reply { status: number; body: string }

export const core = {
  /** Authenticated request as one of the user's accounts. */
  api: (service: Service, method: string, url: string, headers?: Record<string, string>, body?: string) =>
    invoke<Reply>('api_request', { service, method, url, headers, body }),
  /** Unauthenticated request for servers that reject CORS / browser origins. */
  fetch: (method: string, url: string, headers?: Record<string, string>, body?: string) =>
    invoke<Reply>('net_fetch', { method, url, headers, body }),

  login: (service: Service) => invoke<void>('auth_login', { service }),
  /** Pasted token (BMC has no OAuth). Rust tests it before saving. */
  setToken: (service: Service, token: string) => invoke<void>('auth_set_token', { service, token }),
  cancelLogin: (service: Service) => invoke<void>('auth_cancel', { service }),
  logout: (service: Service) => invoke<void>('auth_logout', { service }),
  authState: (service: Service) => invoke<{ loggedIn: boolean; configured: boolean }>('auth_state', { service }),
  builtInLogins: () => invoke<{ youtube: boolean; kick: boolean }>('built_in_logins'),
  socketToken: (service: Service) => invoke<string>('socket_token', { service }),
  obsAuth: (salt: string, challenge: string) => invoke<string>('obs_auth', { salt, challenge }),
  sbAuth: (salt: string, challenge: string) => invoke<string>('sb_auth', { salt, challenge }),

  secretState: () => invoke<SecretState>('secret_state'),
  saveSecret: (key: 'youtubeSecret' | 'kickSecret' | 'obsPassword' | 'sbPassword', value: string | null) => invoke<SecretState>('secret_save', { key, value }),

  readFile: (name: string) => invoke<string | null>('file_read', { name }),
  writeFile: (name: string, text: string) => invoke<void>('file_write', { name, text }),
  appendFile: (name: string, text: string) => invoke<void>('file_append', { name, text }),
  removeFile: (name: string) => invoke<void>('file_remove', { name }),
  listFolder: (folder: 'chat-history' | 'emote-cache') => invoke<string[]>('folder_list', { folder }),
  clearHistory: () => invoke<void>('history_clear'),
  /** Hidden Twitch page that "Raid Now" clicks Twitch's own button on. Open while a raid counts down. */
  raidPage: (open: boolean, channel?: string) => invoke<void>('raid_page', { openPage: open, channel: channel ?? null }),
  raidNow: (channel?: string) => invoke<{ ok: boolean; message?: string }>('raid_now', { channel: channel ?? null }),
  openUrl: (url: string) => invoke<void>('plugin:opener|open_url', { url }),
  log: (scope: string, text: string) => invoke<void>('log_line', { scope, text }).catch(() => {})
}

/** Twitch device-flow code to show while we wait for the user. */
export const onDeviceCode = (cb: (d: { service: Service; code: string; url: string }) => void) =>
  listen<{ service: Service; code: string; url: string }>('auth:device', (e) => cb(e.payload))

/** Fires on login/logout, and when Rust finds a token has expired. */
export const onAuthChanged = (cb: (d: { service: Service; loggedIn: boolean }) => void) =>
  listen<{ service: Service; loggedIn: boolean }>('auth:changed', (e) => cb(e.payload))
