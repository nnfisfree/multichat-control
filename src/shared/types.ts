export type Platform = 'twitch' | 'youtube' | 'kick'
export const PLATFORMS: Platform[] = ['twitch', 'youtube', 'kick']
export const PLATFORM_LABEL: Record<Platform, string> = { twitch: 'Twitch', youtube: 'YouTube', kick: 'Kick' }

export type MessagePart =
  | { type: 'text'; text: string }
  | { type: 'emote'; name: string; url: string }
  | { type: 'link'; url: string; text: string }
  | { type: 'gif'; url: string; alt: string }

export interface Badge { id: string; title: string; url?: string }

interface Author {
  id: string
  name: string
  login?: string
  color?: string
  badges: Badge[]
  isBroadcaster?: boolean
  isMod?: boolean
}

export interface ChatMessage {
  id: string
  platform: Platform
  ts: number
  author: Author
  parts: MessagePart[]
  kind: 'chat' | 'action' | 'announcement' | 'paid' | 'system' | 'event' | 'cheer' | 'highlight'
  /** Set on rows that are an event card rather than a message. */
  event?: StreamEvent
  /** A Power-up changed how this message looks. */
  effect?: 'giant' | 'message-effect'
  reply?: { author: string; text: string }
  deleted?: boolean
  firstTime?: boolean
  /** Short tag shown on highlighted rows, such as a Super Chat amount. */
  label?: string
}

export type EventType =
  | 'follow' | 'sub' | 'gift' | 'cheer' | 'bits' | 'redemption' | 'powerup' | 'raid' | 'hypetrain'
  | 'poll' | 'prediction' | 'goal' | 'ad' | 'shoutout' | 'moderation' | 'stream' | 'paid' | 'announcement' | 'other'

export const EVENT_TYPE_LABEL: Record<EventType, string> = {
  follow: 'Follows', sub: 'Subs', gift: 'Gifts', cheer: 'Cheers', bits: 'Bits', redemption: 'Redemptions',
  powerup: 'Power-ups', raid: 'Raids', hypetrain: 'Hype Train', poll: 'Polls', prediction: 'Predictions',
  goal: 'Goals', ad: 'Ads', shoutout: 'Shoutouts', moderation: 'Moderation', stream: 'Stream', paid: 'Paid',
  announcement: 'Announcements', other: 'Other'
}

interface EventAction { actionId: string; label: string; args: Record<string, string>; tone?: 'good' | 'bad' }

export interface StreamEvent {
  id: string
  platform: Platform
  ts: number
  type: EventType
  /** One-line summary, with the actor kept separate so it can be emphasised. */
  actor?: string
  text: string
  /** Bold name after the text, such as the reward redeemed. */
  subject?: string
  amount?: string
  message?: string
  details: Record<string, string>
  actions?: EventAction[]
  /** Already visible as a chat message, so no event card is needed. */
  noChat?: boolean
  /** Large moments, such as gift bombs, get a stronger card. */
  big?: boolean
}

export interface HypeTrain {
  platform: Platform
  level: number
  progress: number
  goal: number
  total: number
  expiresAt: number
  type: 'regular' | 'golden_kappa' | 'treasure'
  top: { name: string; kind: string; total: number }[]
}

type ConnectionStatus =
  | 'needs-setup' | 'needs-login' | 'authorizing' | 'connecting' | 'connected'
  | 'reconnecting' | 'waiting' | 'error' | 'disabled'

export interface ConnectionState {
  platform: Platform
  status: ConnectionStatus
  account?: string
  detail?: string
  /** Shown while Twitch device login waits for the user. */
  device?: { code: string; url: string }
}

export interface Emote {
  id: string
  name: string
  url: string
  provider: 'twitch' | '7tv' | 'bttv' | 'ffz' | 'kick' | 'emoji'
  platform: Platform
  group: string
  animated?: boolean
}

interface ActionField {
  key: string
  label: string
  type: 'text' | 'number' | 'select' | 'lines'
  options?: { value: string; label: string }[]
  placeholder?: string
  required?: boolean
  default?: string
}

export interface ActionDef {
  id: string
  platform: Platform
  group: string
  label: string
  fields?: ActionField[]
  /** Toggle actions show on/off state. */
  active?: boolean
  confirm?: string
  note?: string
  disabled?: boolean
}

export interface SendResult { platform: Platform; ok: boolean; error?: string }
export interface ActionResult { ok: boolean; message?: string }

export type ModerationRequest =
  | { kind: 'delete'; messageId: string }
  | { kind: 'timeout'; userId: string; userName: string; seconds: number }
  | { kind: 'ban'; userId: string; userName: string }
  | { kind: 'shoutout'; userId: string; userName: string }

export type ChatEventGroup = 'subs' | 'gifts' | 'cheers' | 'raids' | 'redemptions' | 'powerups' | 'follows' | 'paid' | 'hype'

export type CloseAction = 'exit' | 'ask' | 'tray'

export interface EmoteProviders { bttv: boolean; seventv: boolean; ffz: boolean }

export interface Settings {
  twitchClientId: string
  youtubeClientId: string
  kickClientId: string
  sendTargets: Record<Platform, boolean>
  confirmActions: boolean
  fontScale: number
  showTimestamps: boolean
  setupDismissed: boolean
  /** 0 to 1. The main process keeps a small minimum so the window can't vanish. */
  windowOpacity: number
  uiFont: string
  chatFont: string
  showPronouns: boolean
  emoteProviders: EmoteProviders
  chatEvents: Record<ChatEventGroup, boolean>
  closeAction: CloseAction
}

export const DEFAULT_SETTINGS: Settings = {
  twitchClientId: '',
  youtubeClientId: '',
  kickClientId: '',
  sendTargets: { twitch: true, youtube: true, kick: true },
  confirmActions: true,
  fontScale: 1,
  showTimestamps: false,
  setupDismissed: false,
  windowOpacity: 1,
  uiFont: 'Segoe UI',
  chatFont: 'Segoe UI',
  showPronouns: true,
  emoteProviders: { bttv: true, seventv: true, ffz: true },
  // Follows start off because follow bots can flood chat.
  closeAction: 'ask',
  chatEvents: { subs: true, gifts: true, cheers: true, raids: true, redemptions: true, powerups: true, follows: false, paid: true, hype: true }
}

/** Client secrets are write-only from the UI: it learns only whether one is stored. */
export interface SecretState { youtubeSecret: boolean; kickSecret: boolean }

export interface Bootstrap {
  settings: Settings
  secrets: SecretState
  statuses: ConnectionState[]
  messages: ChatMessage[]
  events: StreamEvent[]
  pronouns: Record<string, string>
  hype: HypeTrain | null
  demo: boolean
  builtInTwitchId: boolean
  builtInYoutube: boolean
  builtInKick: boolean
  dataDir: string
  version: string
}

export interface HubBatch {
  messages: ChatMessage[]
  events: StreamEvent[]
  deleted: string[]
  /** Removes all of one user's messages (ban), or a whole platform's (chat clear). */
  purged: { platform: Platform; userId?: string }[]
  statuses: ConnectionState[]
  /** Twitch login to display label, sent as lookups finish. */
  pronouns: Record<string, string>
  /** Latest train state; null ends it, undefined means no change. */
  hype?: HypeTrain | null
}

export interface PanelBounds { x: number; y: number; width: number; height: number }

/** The only surface the renderer can reach. Implemented in the preload script. */
export interface NnfApi {
  bootstrap(): Promise<Bootstrap>
  onBatch(cb: (batch: HubBatch) => void): () => void
  onSettings(cb: (settings: Settings) => void): () => void
  send(targets: Platform[], text: string, replyTo?: { platform: Platform; messageId: string }): Promise<SendResult[]>
  moderate(platform: Platform, req: ModerationRequest): Promise<ActionResult>
  emotes(platform: Platform): Promise<Emote[]>
  actions(platform: Platform): Promise<ActionDef[]>
  runAction(platform: Platform, actionId: string, args: Record<string, string>): Promise<ActionResult>
  login(platform: Platform): Promise<void>
  logout(platform: Platform): Promise<void>
  reconnect(platform: Platform): Promise<void>
  saveSettings(patch: Partial<Settings>): Promise<Settings>
  saveSecret(key: 'youtubeSecret' | 'kickSecret', value: string): Promise<SecretState>
  openExternal(url: string): Promise<void>
  showPanel(bounds: PanelBounds): Promise<ActionResult>
  hidePanel(): Promise<void>
  panelRewardsOnly(on: boolean): Promise<void>
  popOutPanel(): Promise<ActionResult>
  window(action: 'minimize' | 'maximize' | 'close'): void
}

declare global {
  interface Window { nnf: NnfApi }
}
