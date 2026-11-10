import { invoke } from '@tauri-apps/api/core'
import { listen } from '@tauri-apps/api/event'
import type { SecretState } from '../shared/types'

/**
 * Everything the engine asks of the Rust core, in one place. Logins and tokens live in the core:
 * the engine names a service and the core adds the token, so no token ever reaches this page.
 */
export type Service = 'twitch' | 'kick' | 'youtube' | 'streamelements' | 'streamlabs'

export interface Reply { status: number; body: string }

export const core = {
  /** A request made as one of the user's accounts. */
  api: (service: Service, method: string, url: string, headers?: Record<string, string>, body?: string) =>
    invoke<Reply>('api_request', { service, method, url, headers, body }),
  /** A plain request with no account, for servers that don't accept requests from web pages. */
  fetch: (method: string, url: string, headers?: Record<string, string>, body?: string) =>
    invoke<Reply>('net_fetch', { method, url, headers, body }),

  login: (service: Service) => invoke<void>('auth_login', { service }),
  cancelLogin: (service: Service) => invoke<void>('auth_cancel', { service }),
  logout: (service: Service) => invoke<void>('auth_logout', { service }),
  authState: (service: Service) => invoke<{ loggedIn: boolean; configured: boolean }>('auth_state', { service }),
  builtInLogins: () => invoke<{ youtube: boolean; kick: boolean }>('built_in_logins'),
  socketToken: (service: Service) => invoke<string>('socket_token', { service }),
  obsAuth: (salt: string, challenge: string) => invoke<string>('obs_auth', { salt, challenge }),

  secretState: () => invoke<SecretState>('secret_state'),
  saveSecret: (key: 'youtubeSecret' | 'kickSecret' | 'obsPassword', value: string | null) => invoke<SecretState>('secret_save', { key, value }),

  readFile: (name: string) => invoke<string | null>('file_read', { name }),
  writeFile: (name: string, text: string) => invoke<void>('file_write', { name, text }),
  appendFile: (name: string, text: string) => invoke<void>('file_append', { name, text }),
  removeFile: (name: string) => invoke<void>('file_remove', { name }),
  listFolder: (folder: 'chat-history' | 'emote-cache') => invoke<string[]>('folder_list', { folder }),
  clearHistory: () => invoke<void>('history_clear'),
  openUrl: (url: string) => invoke<void>('plugin:opener|open_url', { url }),
  log: (scope: string, text: string) => invoke<void>('log_line', { scope, text }).catch(() => {})
}

/** The Twitch login code to show while the device login waits for the user. */
export const onDeviceCode = (cb: (d: { service: Service; code: string; url: string }) => void) =>
  listen<{ service: Service; code: string; url: string }>('auth:device', (e) => cb(e.payload))

/** A login appeared or disappeared, including when the core finds one has expired. */
export const onAuthChanged = (cb: (d: { service: Service; loggedIn: boolean }) => void) =>
  listen<{ service: Service; loggedIn: boolean }>('auth:changed', (e) => cb(e.payload))
