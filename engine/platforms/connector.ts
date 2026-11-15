import type {
  ActionDef, ActionResult, ChannelStats, ChatMessage, ConnectionState, Emote, HypeTrain, CommandOutcome, ModerationRequest, PinnedMessage, Platform, RaidInfo, StreamEvent, UserEntry, UserProfile, UsersInfo
} from '../../shared/types'

/** What a connector gets from the hub. */
export interface ConnectorContext {
  message(m: ChatMessage): void
  /**
   * Updates a message that's already in chat (e.g. a held message got allowed). false if there's
   * no message with that id (yet).
   */
  patch(messageId: string, change: (m: ChatMessage) => Partial<ChatMessage>): boolean
  event(e: StreamEvent): void
  deleted(messageId: string): void
  purged(userId?: string): void
  pronoun(login: string, label: string): void
  hype(train: HypeTrain | null): void
  /** Quick actions changed, e.g. a reward got turned on or off. */
  actionsChanged(): void
  pinned?(p: PinnedMessage | null): void
  /** Our raid started, went out, or got cancelled. */
  raid?(r: RaidInfo | null): void
  status(s: Omit<ConnectionState, 'platform'>): void
}

export interface Connector {
  readonly platform: Platform
  /** Connects with stored credentials, or reports what's missing. */
  start(): Promise<void>
  stop(): Promise<void>
  login(): Promise<void>
  logout(): Promise<void>
  send(text: string, replyTo?: string): Promise<void>
  moderate(req: ModerationRequest): Promise<ActionResult>
  emotes(): Promise<Emote[]>
  actions(): Promise<ActionDef[]>
  runAction(actionId: string, args: Record<string, string>): Promise<ActionResult>
  /** Reload emotes after the provider settings changed. */
  refreshEmotes(): Promise<void>
  /** Live state, viewer count, and the platform's chatter list where it has one. */
  users?(): Promise<UsersInfo>
  /** Whatever follower/sub counts the platform shares. */
  stats?(): Promise<ChannelStats>
  /** Whatever account info the platform shares, for the user card. */
  profile?(user: UserEntry): Promise<UserProfile>
  /** Typed chat command. null if this platform doesn't know it. */
  command?(text: string): Promise<CommandOutcome | null>
  /** Allow/deny an AutoMod hold (Twitch only). */
  automod?(messageId: string, allow: boolean): Promise<ActionResult>
}
