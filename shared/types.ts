export type Platform = 'twitch' | 'youtube' | 'kick'
export const PLATFORMS: Platform[] = ['twitch', 'youtube', 'kick']
export const PLATFORM_LABEL: Record<Platform, string> = { twitch: 'Twitch', youtube: 'YouTube', kick: 'Kick' }

export type MessagePart =
  | { type: 'text'; text: string }
  | { type: 'emote'; name: string; url: string; overlay?: boolean }
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
  isVip?: boolean
  /** A YouTube channel member. */
  isMember?: boolean
}

export interface UserEntry { id: string; name: string; login?: string; color?: string }

/** The message pinned in Twitch chat, if any. */
export interface PinnedMessage { id: string; text: string; sender: string; endsAt?: number }

/** The result of a typed command. */
export type CommandOutcome = ActionResult & { openUser?: UserEntry }

/** What a platform tells about one account. Undefined means unknown; null means "no". */
export interface UserProfile {
  avatar?: string
  createdAt?: number
  followedAt?: number | null
  sub?: { tier?: string; months?: number; gift?: boolean } | null
  member?: boolean
  roles?: string[]
  banned?: { until?: number } | null
  url?: string
  about?: string
}

/** Everything the user card shows: the profile plus their history in this channel. */
export interface UserCard extends UserProfile {
  platform: Platform
  id: string
  name: string
  login?: string
  color?: string
  /** Their messages in this channel, newest first, from this stream and the saved streams. */
  messages: ChatMessage[]
  total: number
  firstSeen?: number
  /** In how many of the saved streams (plus this one) they chatted. */
  streams: number
  ofStreams: number
  deleted: number
  timeouts: number
  bans: number
}
export interface UserGroups { broadcaster: UserEntry[]; moderators: UserEntry[]; vips: UserEntry[]; members: UserEntry[]; users: UserEntry[] }

/** What a platform itself reports about who is watching. */
export interface UsersInfo {
  live: boolean
  viewers?: number
  /** The platform's own list of users in chat, where it has one (Twitch). */
  groups?: UserGroups
  /** The login is missing the permission needed for the full list. */
  needsRelogin?: boolean
}

export interface PlatformUsers extends UsersInfo {
  platform: Platform
  /** 'chatters' is the platform's own list; 'chat' is everyone who chatted this stream. */
  source: 'chatters' | 'chat'
  groups: UserGroups
  updatedAt: number
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
  /** From a past stream's saved history. */
  history?: boolean
  /** A line between past streams and this one, rather than a message. */
  divider?: string
}

/** One saved past stream's chat. */
export interface HistorySession { id: string; start: number; end: number; count: number }

export type EventType =
  | 'follow' | 'sub' | 'gift' | 'cheer' | 'bits' | 'redemption' | 'powerup' | 'raid' | 'hypetrain'
  | 'poll' | 'prediction' | 'goal' | 'ad' | 'shoutout' | 'moderation' | 'stream' | 'paid' | 'donation' | 'announcement' | 'other'

export const EVENT_TYPE_LABEL: Record<EventType, string> = {
  follow: 'Follows', sub: 'Subs', gift: 'Gifts', cheer: 'Cheers', bits: 'Bits', redemption: 'Redemptions',
  powerup: 'Power-ups', raid: 'Raids', hypetrain: 'Hype Train', poll: 'Polls', prediction: 'Predictions',
  goal: 'Goals', ad: 'Ads', shoutout: 'Shoutouts', moderation: 'Moderation', stream: 'Stream', paid: 'Paid', donation: 'Donations',
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
  /** Loaded from an earlier session or the platform's history, so it never becomes a chat card. */
  history?: boolean
  /** Reported by an alert service rather than the platform itself. */
  source?: AlertSource
}

/** Alert and donation services that report events for the platforms. */
export type AlertSource = 'streamelements' | 'streamlabs'
export const ALERT_SOURCES: AlertSource[] = ['streamelements', 'streamlabs']
export const ALERT_SOURCE_LABEL: Record<AlertSource, string> = { streamelements: 'StreamElements', streamlabs: 'Streamlabs' }

export interface IntegrationState {
  source: AlertSource
  status: 'off' | 'needs-setup' | 'needs-login' | 'authorizing' | 'connecting' | 'connected' | 'reconnecting' | 'error'
  account?: string
  detail?: string
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
  /** Avatar shown beside the group's heading. */
  groupIcon?: string
  animated?: boolean
  /** Drawn on top of the emote before it, like 7TV's RainTime. */
  zeroWidth?: boolean
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

export type ChatEventGroup = 'subs' | 'gifts' | 'cheers' | 'raids' | 'redemptions' | 'powerups' | 'follows' | 'paid' | 'donations' | 'hype'

export type CloseAction = 'exit' | 'ask' | 'tray'

export interface EmoteProviders { bttv: boolean; seventv: boolean; ffz: boolean }

export interface UpdateInfo {
  version: string
  notes: string
  page: string
  /** False when this copy can't update itself, so the download page is offered instead. */
  canInstall: boolean
  size?: number
}

export interface UpdateState {
  status: 'idle' | 'checking' | 'none' | 'available' | 'downloading' | 'ready' | 'error'
  current: string
  info?: UpdateInfo
  progress?: number
  error?: string
  checkedAt?: number
}

export interface EventFilter { platforms: Record<Platform, boolean>; hiddenTypes: EventType[]; oldestFirst?: boolean }

export interface Settings {
  twitchClientId: string
  youtubeClientId: string
  kickClientId: string
  sendTargets: Record<Platform, boolean>
  confirmActions: boolean
  /** The PC clock under the message box. */
  showClock: boolean
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
  eventFilter: EventFilter
  autoUpdate: boolean
  updatePrereleases: boolean
  /** The one alert service this streamer uses, if any. */
  alertService: AlertSource | 'none'
  /** Saves chat from the last five streams on this PC. */
  keepChatHistory: boolean
  /** Reads stream health from OBS's WebSocket server on this PC. */
  obsEnabled: boolean
  obsPort: number
  /** The skin's id, from the renderer's skins list. */
  theme: string
}

export const DEFAULT_SETTINGS: Settings = {
  twitchClientId: '',
  youtubeClientId: '',
  kickClientId: '',
  sendTargets: { twitch: true, youtube: true, kick: true },
  confirmActions: true,
  showClock: true,
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
  eventFilter: { platforms: { twitch: true, youtube: true, kick: true }, hiddenTypes: [] },
  autoUpdate: true,
  updatePrereleases: false,
  alertService: 'none',
  keepChatHistory: true,
  obsEnabled: false,
  obsPort: 4455,
  theme: 'pos',
  chatEvents: { subs: true, gifts: true, cheers: true, raids: true, redemptions: true, powerups: true, follows: false, paid: true, donations: true, hype: true }
}

/** Client secrets are write-only from the UI: it learns only whether one is stored. */
export interface SecretState { youtubeSecret: boolean; kickSecret: boolean; obsPassword: boolean }

/** Stream health read from OBS. Sizes in MB, durations in ms, bitrates in kb/s. */
export interface ObsStats {
  cpu: number
  memoryMb: number
  diskMb: number
  fps: number
  renderMs: number
  /** When these stats were read, so the uptime can keep counting between updates. */
  at: number
  /** The stream encoder in plain words, and the output video size and frame rate. */
  encoder?: string
  output?: {
    width: number
    height: number
    fps: number
    /** The canvas OBS draws on, before scaling. */
    canvas?: { width: number; height: number }
    /** Set when the stream encoder rescales again (Advanced output mode). */
    stream?: { width: number; height: number }
  }
  renderMissed: number
  renderTotal: number
  encodeSkipped: number
  encodeTotal: number
  stream: { active: boolean; reconnecting: boolean; durationMs: number; dropped: number; total: number; bytes: number; kbps?: number }
  record: { active: boolean; paused: boolean; durationMs: number; bytes: number; kbps?: number }
}

export interface ObsState {
  status: 'off' | 'connecting' | 'connected' | 'error'
  detail?: string
  stats?: ObsStats
}

export interface Bootstrap {
  settings: Settings
  secrets: SecretState
  statuses: ConnectionState[]
  messages: ChatMessage[]
  events: StreamEvent[]
  pronouns: Record<string, string>
  hype: HypeTrain | null
  integrations: IntegrationState[]
  pinned: PinnedMessage | null
  update: UpdateState
  panelSignedIn: boolean | null
  obs: ObsState
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
  /** Platforms whose quick actions changed, such as a reward being turned on. */
  actionsChanged?: Platform[]
  integrations?: IntegrationState[]
  /** The pinned Twitch message; null when it is removed, undefined means no change. */
  pinned?: PinnedMessage | null
}

/** The skin's colours, so Twitch's rewards panel can match the app. */
export interface PanelColors { window: string; base: string; alt: string; text: string; muted: string; accent: string; accentHover: string; onAccent: string; line: string }
export interface PanelBounds { x: number; y: number; width: number; height: number; colors?: PanelColors }

/** The only surface the renderer can reach. Implemented in the preload script. */
export interface NnfApi {
  bootstrap(): Promise<Bootstrap>
  onBatch(cb: (batch: HubBatch) => void): () => void
  onSettings(cb: (settings: Settings) => void): () => void
  onUpdate(cb: (state: UpdateState) => void): () => void
  onPanelSignedIn(cb: (signedIn: boolean) => void): () => void
  onObs(cb: (state: ObsState) => void): () => void
  obs: { setPassword(password: string): Promise<SecretState>; reconnect(): Promise<void> }
  updates: { check(): Promise<UpdateState>; download(): Promise<void>; install(): Promise<void>; openPage(): Promise<void> }
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
  removeEvents(ids: string[]): Promise<void>
  users(platform: Platform): Promise<PlatformUsers>
  userCard(platform: Platform, user: UserEntry): Promise<UserCard>
  /** Runs a Twitch chat command such as /raid or /pin. */
  twitchCommand(text: string): Promise<CommandOutcome>
  history: {
    sessions(): Promise<HistorySession[]>
    load(id: string): Promise<ChatMessage[]>
    clear(): Promise<void>
  }
  alerts: {
    login(source: AlertSource): Promise<void>
    logout(source: AlertSource): Promise<void>
    reconnect(source: AlertSource): Promise<void>
  }
  openExternal(url: string): Promise<void>
  showPanel(bounds: PanelBounds): Promise<ActionResult>
  hidePanel(): Promise<void>
  window(action: 'minimize' | 'maximize' | 'close'): void
}

declare global {
  interface Window { nnf: NnfApi }
}
