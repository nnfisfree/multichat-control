export type Platform = 'twitch' | 'youtube' | 'kick' | 'tiktok'
export const PLATFORMS: Platform[] = ['twitch', 'youtube', 'kick', 'tiktok']
export const PLATFORM_LABEL: Record<Platform, string> = { twitch: 'Twitch', youtube: 'YouTube', kick: 'Kick', tiktok: 'TikTok' }
/** Platforms we can only read for now: no sending, no moderation. */
export const READ_ONLY: Platform[] = ['tiktok']
/** Where TikTok users make the free Euler Stream key the TikTok connection needs. */
export const EULER_KEY_URL = 'https://www.eulerstream.com/dashboard'

export type MessagePart =
  | { type: 'text'; text: string }
  /** `giant`: made huge by Twitch's "Gigantify an Emote" Power-up. */
  | { type: 'emote'; name: string; url: string; overlay?: boolean; giant?: boolean }
  | { type: 'link'; url: string; text: string }
  | { type: 'gif'; url: string; alt: string }

export interface Badge { id: string; title: string; url?: string }

/** Card under a YouTube video link or a Twitch/Kick/YouTube clip link. */
export interface LinkPreview {
  url: string
  platform: Platform
  kind: 'video' | 'short' | 'clip'
  title: string
  channel?: string
  thumbnail?: string
  /** Seconds, if the platform tells us. */
  seconds?: number
  views?: number
  clippedBy?: string
}

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

export interface PinnedMessage { id: string; text: string; sender: string; endsAt?: number }

/** Our outgoing raid during Twitch's countdown. */
export interface RaidInfo {
  login: string
  name: string
  avatar?: string
  /** What they're streaming, or their last category if they're offline. */
  game?: string
  title?: string
  viewers?: number
  live: boolean
  startedAt: number
  /** When Twitch sends it automatically. */
  endsAt: number
}

export type CommandOutcome = ActionResult & { openUser?: UserEntry }

/** Account info for the user card. undefined = unknown, null = no. */
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

/** Profile plus this person's history in the channel. */
export interface UserCard extends UserProfile {
  platform: Platform
  id: string
  name: string
  login?: string
  color?: string
  /** Newest first, current stream plus saved history. */
  messages: ChatMessage[]
  total: number
  firstSeen?: number
  /** Number of streams (saved ones + this one) they chatted in. */
  streams: number
  ofStreams: number
  deleted: number
  timeouts: number
  bans: number
}
export interface UserGroups { broadcaster: UserEntry[]; moderators: UserEntry[]; vips: UserEntry[]; members: UserEntry[]; users: UserEntry[] }

/** What the platform itself tells us about who's watching. */
export interface UsersInfo {
  live: boolean
  viewers?: number
  /** The platform's own chatter list, where there is one (Twitch only). */
  groups?: UserGroups
  /** Token lacks the scope the full list needs. */
  needsRelogin?: boolean
}

export interface PlatformUsers extends UsersInfo {
  platform: Platform
  /** 'chatters' = the platform's list, 'chat' = everyone who's talked this stream. */
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
  /** Set when this row is an event card, not a message. */
  event?: StreamEvent
  /** Changed by a Power-up: "Gigantify an Emote" or "Message Effects" (the animated outline). */
  effect?: 'giant' | 'message-effect'
  /** Which Message Effect, when Twitch says (it only does in the Bits event, see twitch/connector.ts). */
  effectId?: string
  reply?: { author: string; text: string }
  deleted?: boolean
  firstTime?: boolean
  /** Short tag on highlighted rows, e.g. a Super Chat amount. */
  label?: string
  /** Loaded from a past stream's saved history. */
  history?: boolean
  /** Divider between past streams and this one (not a message). */
  divider?: string
  /** Held by AutoMod: nobody else sees it until a mod allows it. */
  held?: HeldInfo
  /** Mod warning: Twitch flagged the sender as suspicious, or our own spam check matched. */
  flag?: MessageFlag
}

export interface HeldInfo {
  /** Readable reason, e.g. "AutoMod: Profanity (level 3)" or "Blocked link". */
  reason: string
  status: 'pending' | 'allowed' | 'denied' | 'expired'
  /** The mod who allowed/denied it. */
  by?: string
}

export interface MessageFlag {
  /** 'suspicious' comes from Twitch, 'spam' is our own check (all platforms). */
  kind: 'suspicious' | 'spam'
  label: string
  /** e.g. "Likely ban evader" */
  notes: string[]
}

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
  /** Kept separate from the text so the UI can bold it. */
  actor?: string
  text: string
  /** Bold bit after the text, e.g. the reward that was redeemed. */
  subject?: string
  amount?: string
  message?: string
  details: Record<string, string>
  actions?: EventAction[]
  /** Already shows as a chat message, so no event card. */
  noChat?: boolean
  /** Gift bombs and the like, get a bigger card. */
  big?: boolean
  /** From an earlier session or the platform's history. Never turns into a chat card. */
  history?: boolean
  /** Reported by an alert service instead of the platform. */
  source?: AlertSource
  /** Card for a newly created clip. */
  preview?: LinkPreview
  /** Small picture next to the subject, e.g. the TikTok gift that was sent. */
  image?: string
  /** Test alert (SB test trigger, SE or SL test). Never saved, gone after a restart. */
  test?: boolean
  /** Total months subscribed, including this one. */
  months?: number
  /** Twitch resubs: consecutive months, if the viewer shares it. */
  streak?: number
}

export type AlertSource = 'streamelements' | 'streamlabs' | 'buymeacoffee'
/** The user picks one of these. BMC runs alongside, not instead. */
export type PickedAlertSource = 'streamelements' | 'streamlabs'
export const ALERT_SOURCES: PickedAlertSource[] = ['streamelements', 'streamlabs']
export const ALERT_SOURCE_LABEL: Record<AlertSource, string> = { streamelements: 'StreamElements', streamlabs: 'Streamlabs', buymeacoffee: 'Buy Me a Coffee' }
// where a BMC creator generates the read-only token we connect with
export const BMC_TOKEN_URL = 'https://developers.buymeacoffee.com/dashboard'

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
  /** Channel login (Twitch), for links like Twitch's popout viewer card. */
  channel?: string
  /** Names viewers tag the streamer with (no @), used to highlight mentions. */
  mentions?: string[]
  detail?: string
  /** Shown while the Twitch device login is waiting. */
  device?: { code: string; url: string }
  /** Connected, but some newer feature needs a fresh login. Says which. */
  relogin?: string
}

export interface Emote {
  id: string
  name: string
  url: string
  provider: 'twitch' | '7tv' | 'bttv' | 'ffz' | 'kick' | 'tiktok' | 'emoji'
  platform: Platform
  group: string
  /** Avatar next to the group heading. */
  groupIcon?: string
  animated?: boolean
  /** Drawn on top of the previous emote (7TV zero-width, e.g. RainTime). */
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
  /** Toggle actions show their on/off state. */
  active?: boolean
  confirm?: string
  note?: string
  disabled?: boolean
}

export interface SendResult { platform: Platform; ok: boolean; error?: string }
export interface ActionResult { ok: boolean; message?: string }

/** Follower/sub counts for the stats pills. Missing = unknown. */
export interface ChannelStats {
  followers?: number
  subscribers?: number
  /** Kick only: how many of the subs are gifted. */
  gifted?: number
  /** YouTube rounds sub counts to 3 significant figures. */
  rounded?: boolean
}

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
  /** false when this copy can't self-update; we link to the download page instead. */
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

/** How names are coloured in chat: the platform's own colours, the platform's brand colour, a colour per person, or one colour for everyone. */
export type NameColorMode = 'default' | 'platform' | 'random' | 'custom'
export type NameRole = 'broadcaster' | 'mod' | 'vip' | 'member'
/** Where one kind of event shows: as a card in chat, and in the Events tab (plus its pop-ups). */
export interface EventShow { chat: boolean; feed: boolean }
/** Per-platform chat options. Everything is optional, missing means the default. */
export interface PlatformPrefs {
  nameColor?: NameColorMode
  customColor?: string
  /** Wins over nameColor for people with that role. */
  roleColors?: Partial<Record<NameRole, string>>
  /** Only the switches the user changed. */
  events?: Partial<Record<EventType, Partial<EventShow>>>
  /** Twitch: show GIFs in messages, or just their name. */
  showGifs?: boolean
}

export interface EventFilter { platforms: Record<Platform, boolean>; hiddenTypes: EventType[]; oldestFirst?: boolean }

export interface Settings {
  twitchClientId: string
  youtubeClientId: string
  kickClientId: string
  /** TikTok @handle to read (no login: TikTok chat is read by username). */
  tiktokUsername: string
  sendTargets: Record<Platform, boolean>
  confirmActions: boolean
  showClock: boolean
  showStats: boolean
  /** Version whose What's New the user already dismissed. Empty before the first one. */
  seenVersion: string
  fontScale: number
  showTimestamps: boolean
  setupDismissed: boolean
  /** 0-1. Rust clamps it to a small minimum so the window can't vanish completely. */
  windowOpacity: number
  /** KDE-style wobbly window while dragging by the title bar. */
  windowWobble: boolean
  /** The connection line under the tabs keeps a calm glow and a slow comet once everything is up. */
  connectionLine: boolean
  /** 0-100 */
  wobbleIntensity: number
  uiFont: string
  chatFont: string
  showPronouns: boolean
  /** Preview cards under YouTube and clip links. */
  linkPreviews: boolean
  /** Flag "buy followers" spam (all platforms). */
  spamWarnings: boolean
  emoteProviders: EmoteProviders
  chatEvents: Record<ChatEventGroup, boolean>
  /** Pop-ups at the top of chat for new events. */
  eventPopups: boolean
  /** Seconds each pop-up stays up. */
  eventPopupSeconds: number
  closeAction: CloseAction
  eventFilter: EventFilter
  autoUpdate: boolean
  updatePrereleases: boolean
  alertService: PickedAlertSource | 'none'
  /** Keep chat from the last five streams on this PC. */
  keepChatHistory: boolean
  /** Stream stats from the streaming app below (the name stayed from when it was OBS only). */
  obsEnabled: boolean
  /** Which streaming app the stats come from. */
  streamApp: StreamApp
  /** Streamlabs Desktop's Remote Control port. */
  slPort: number
  /** Meld Studio's WebChannel port. */
  meldPort: number
  /** The one-time OBS tip was shown and dismissed. */
  obsTipSeen: boolean
  /** OBS connected at least once, so the tip isn't needed. */
  obsSetUp: boolean
  obsPort: number
  /** Streamer.bot actions via its WebSocket server. */
  sbEnabled: boolean
  sbPort: number
  /** Skin id, see ui/styles/skins.ts. */
  theme: string
  /** Ticked "Don't show this again" on the note about Google's "unverified app" warning. */
  youtubeNoticeSeen: boolean
  /** Per-platform username colours and event switches (Twitch, YouTube, Kick). */
  platformPrefs: Partial<Record<Platform, PlatformPrefs>>
  /** Chatters whose messages are hidden from chat, "platform:userId" -> name. */
  ignoredUsers: Record<string, string>
  /** Chatters whose messages stand out in chat, "platform:userId" -> name. */
  highlightedUsers: Record<string, string>
}

export const DEFAULT_SETTINGS: Settings = {
  twitchClientId: '',
  youtubeClientId: '',
  kickClientId: '',
  tiktokUsername: '',
  sendTargets: { twitch: true, youtube: true, kick: true, tiktok: false },
  confirmActions: true,
  showClock: true,
  showStats: true,
  seenVersion: '',
  fontScale: 1,
  showTimestamps: false,
  setupDismissed: false,
  windowOpacity: 1,
  windowWobble: false,
  connectionLine: true,
  wobbleIntensity: 50,
  uiFont: 'Segoe UI',
  chatFont: 'Segoe UI',
  showPronouns: true,
  linkPreviews: true,
  spamWarnings: true,
  emoteProviders: { bttv: true, seventv: true, ffz: true },
  closeAction: 'ask',
  eventPopups: true,
  eventPopupSeconds: 6,
  eventFilter: { platforms: { twitch: true, youtube: true, kick: true, tiktok: true }, hiddenTypes: [] },
  autoUpdate: true,
  updatePrereleases: false,
  alertService: 'none',
  keepChatHistory: true,
  // on by default, it just sits there quietly until OBS is reachable
  obsEnabled: true,
  obsTipSeen: false,
  obsSetUp: false,
  obsPort: 4455,
  streamApp: 'obs',
  slPort: 59650,
  meldPort: 13376,
  sbEnabled: false,
  sbPort: 8080,
  // new installs start on Sweet; engine/store.ts keeps POS Club for anyone upgrading
  theme: 'sweet',
  youtubeNoticeSeen: false,
  platformPrefs: {},
  ignoredUsers: {},
  highlightedUsers: {},
  // all event types on by default, each one can be turned off in Settings
  chatEvents: { subs: true, gifts: true, cheers: true, raids: true, redemptions: true, powerups: true, follows: true, paid: true, donations: true, hype: true }
}

/** Secrets are write-only from the UI, it only ever learns whether one is stored. */
export interface SecretState { youtubeSecret: boolean; kickSecret: boolean; obsPassword: boolean; sbPassword: boolean; slToken: boolean; tiktokKey: boolean }

/** Streaming apps we can read stats from. */
export type StreamApp = 'obs' | 'streamlabs' | 'meld'
export const STREAM_APPS: Record<StreamApp, string> = { obs: 'OBS Studio', streamlabs: 'Streamlabs Desktop', meld: 'Meld Studio' }

/**
 * Stream stats. Sizes in MB, durations in ms, bitrates in kb/s. OBS fills everything; Streamlabs
 * only shares CPU, FPS, bitrate and dropped frames; Meld only whether it's live or recording.
 */
export interface ObsStats {
  app: StreamApp
  cpu: number
  memoryMb: number
  diskMb: number
  fps: number
  renderMs: number
  /** When these were read, so the uptime can keep ticking between updates. */
  at: number
  /** Readable encoder name, plus output size and fps. */
  encoder?: string
  output?: {
    width: number
    height: number
    fps: number
    /** Base canvas, before scaling. */
    canvas?: { width: number; height: number }
    /** Set when the encoder rescales again (Advanced output mode). */
    stream?: { width: number; height: number }
  }
  renderMissed: number
  renderTotal: number
  encodeSkipped: number
  encodeTotal: number
  /** durationKnown is false when we joined a stream already running and the app can't say since when. */
  stream: { active: boolean; reconnecting: boolean; durationMs: number; durationKnown?: boolean; dropped: number; total: number; droppedPct?: number; bytes: number; kbps?: number }
  record: { active: boolean; paused: boolean; durationMs: number; bytes: number; kbps?: number }
}

export interface ObsState {
  status: 'off' | 'connecting' | 'connected' | 'error'
  detail?: string
  stats?: ObsStats
}

export interface SbAction { id: string; name: string; group: string; enabled: boolean }
/** A Streamer.bot chat command (e.g. !lurk). SB runs it itself when it sees it in chat. */
export interface SbCommand { id: string; name: string; group: string; enabled: boolean; commands: string[] }

export interface StreamerbotState {
  status: 'off' | 'connecting' | 'connected' | 'error'
  detail?: string
  version?: string
  actions: SbAction[]
  commands: SbCommand[]
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
  raid: RaidInfo | null
  update: UpdateState
  panelSignedIn: boolean | null
  obs: ObsState
  streamerbot: StreamerbotState
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
  /** Changed messages (e.g. a held message got allowed). Replace the ones with the same id. */
  updated?: ChatMessage[]
  /** Wipes one user's messages (ban) or a whole platform's (chat clear). */
  purged: { platform: Platform; userId?: string }[]
  statuses: ConnectionState[]
  /** Twitch login -> display label, sent as lookups finish. */
  pronouns: Record<string, string>
  /** null ends the train, undefined = no change. */
  hype?: HypeTrain | null
  /** Platforms whose quick actions changed, e.g. a reward got enabled. */
  actionsChanged?: Platform[]
  integrations?: IntegrationState[]
  /** null = unpinned, undefined = no change. */
  pinned?: PinnedMessage | null
  /** null = sent or cancelled, undefined = no change. */
  raid?: RaidInfo | null
}

/** Skin colours, so Twitch's rewards panel can match the app. */
export interface PanelColors { window: string; base: string; alt: string; text: string; muted: string; accent: string; accentHover: string; onAccent: string; line: string }
export interface PanelBounds { x: number; y: number; width: number; height: number; colors?: PanelColors }

/** Everything the UI can call. Implemented by the engine (engine/index.ts) and exposed as window.nnf. */
export interface NnfApi {
  bootstrap(): Promise<Bootstrap>
  onBatch(cb: (batch: HubBatch) => void): () => void
  onSettings(cb: (settings: Settings) => void): () => void
  onUpdate(cb: (state: UpdateState) => void): () => void
  onPanelSignedIn(cb: (signedIn: boolean) => void): () => void
  onObs(cb: (state: ObsState) => void): () => void
  obs: { setPassword(password: string): Promise<SecretState>; setStreamlabsToken(token: string): Promise<SecretState>; reconnect(): Promise<void> }
  onStreamerbot(cb: (state: StreamerbotState) => void): () => void
  streamerbot: {
    setPassword(password: string): Promise<SecretState>
    reconnect(): Promise<void>
    /** `input` arrives as rawInput, input0, input1... */
    run(actionId: string, input?: string): Promise<ActionResult>
  }
  updates: { check(): Promise<UpdateState>; download(): Promise<void>; install(): Promise<void>; openPage(): Promise<void> }
  send(targets: Platform[], text: string, replyTo?: { platform: Platform; messageId: string }): Promise<SendResult[]>
  moderate(platform: Platform, req: ModerationRequest): Promise<ActionResult>
  /** Allow/deny an AutoMod hold, by its held-message row id. */
  automod(messageId: string, allow: boolean): Promise<ActionResult>
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
  /** Whatever the platform shares. null when not connected. */
  stats(platform: Platform): Promise<ChannelStats | null>
  userCard(platform: Platform, user: UserEntry): Promise<UserCard>
  /** null when the link has no card or the lookup fails. */
  linkPreview(url: string): Promise<LinkPreview | null>
  /** Slash commands like /raid or /pin. */
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
    /** BMC: saves a pasted token (tested first), then starts. */
    connect(source: 'buymeacoffee', token: string): Promise<void>
  }
  tiktok: {
    /** Checks the username (and the key, when one is given), saves them, then starts reading. */
    connect(username: string, key?: string): Promise<SecretState>
    /** Stops reading and forgets the username and key. */
    disconnect(): Promise<SecretState>
  }
  openExternal(url: string): Promise<void>
  showPanel(bounds: PanelBounds): Promise<ActionResult>
  hidePanel(): Promise<void>
  window(action: 'minimize' | 'maximize' | 'close'): void
}

declare global {
  interface Window { nnf: NnfApi }
}
