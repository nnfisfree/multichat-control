import type { ChatMessage, ConnectionState } from './types'

/** The chat notice a connector posts when its login lacks permissions a newer feature needs. */
export const isReloginNotice = (m: ChatMessage): boolean => m.kind === 'system' && m.id.startsWith('relogin-')

/** Connected with a login that has every permission, so the "log in again" notices are done. */
export const reloginDone = (s: ConnectionState | undefined): boolean => s?.status === 'connected' && !s.relogin
