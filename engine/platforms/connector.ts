import type {
  ActionDef, ActionResult, ChatMessage, ConnectionState, Emote, HypeTrain, CommandOutcome, ModerationRequest, PinnedMessage, Platform, RaidInfo, StreamEvent, UserEntry, UserProfile, UsersInfo
} from '../../shared/types'

/** How a connector reports to the hub. */
export interface ConnectorContext {
  message(m: ChatMessage): void
  event(e: StreamEvent): void
  deleted(messageId: string): void
  purged(userId?: string): void
  pronoun(login: string, label: string): void
  hype(train: HypeTrain | null): void
  /** Quick actions changed, such as a reward being turned on or off. */
  actionsChanged(): void
  /** The pinned chat message changed. */
  pinned?(p: PinnedMessage | null): void
  /** An outgoing raid started, or went, or was cancelled. */
  raid?(r: RaidInfo | null): void
  status(s: Omit<ConnectionState, 'platform'>): void
}

export interface Connector {
  readonly platform: Platform
  /** Connects using stored credentials, or reports what is missing. */
  start(): Promise<void>
  stop(): Promise<void>
  /** Runs the interactive login. */
  login(): Promise<void>
  logout(): Promise<void>
  send(text: string, replyTo?: string): Promise<void>
  moderate(req: ModerationRequest): Promise<ActionResult>
  emotes(): Promise<Emote[]>
  actions(): Promise<ActionDef[]>
  runAction(actionId: string, args: Record<string, string>): Promise<ActionResult>
  /** Reloads emotes after the provider settings change. */
  refreshEmotes(): Promise<void>
  /** Live state, viewer count and, where the platform has one, its list of users in chat. */
  users?(): Promise<UsersInfo>
  /** Account details for the user card, as far as the platform shares them. */
  profile?(user: UserEntry): Promise<UserProfile>
  /** Runs a typed chat command; null when the command is not one this platform knows. */
  command?(text: string): Promise<CommandOutcome | null>
}
