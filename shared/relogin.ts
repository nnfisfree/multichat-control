import type { ChatMessage, ConnectionState } from './types'

/** Notice a connector posts when the login is missing scopes some newer feature needs. */
export const isReloginNotice = (m: ChatMessage): boolean => m.kind === 'system' && m.id.startsWith('relogin-')

/** Connected with every scope we need, so the "log in again" notices can go. */
export const reloginDone = (s: ConnectionState | undefined): boolean => s?.status === 'connected' && !s.relogin
