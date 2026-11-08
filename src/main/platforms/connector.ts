import type {
  ActionDef, ActionResult, ChatMessage, ConnectionState, Emote, HypeTrain, ModerationRequest, Platform, StreamEvent
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
}
