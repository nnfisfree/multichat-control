import { TWITCH_COMMANDS, TWITCH_COMMAND_NAMES } from '../../shared/twitch-commands'
import type { SbAction, StreamerbotState } from '../../shared/types'
import { clearHistory } from './store'

/** App-side commands typed in the message box. Never sent to a platform. */
export interface Command {
  name: string
  description: string
  /** Returns the line to show the user afterwards. */
  run(): Promise<string>
}

export const COMMANDS: Command[] = [
  {
    name: '/clearhistory',
    description: "Clears the chat here and deletes the saved chat of past streams on this PC. Your viewers' chat isn't affected.",
    run: async () => {
      await clearHistory()
      return "Chat history cleared on this PC. Your viewers' chat isn't affected."
    }
  }
]

export function findCommand(text: string): Command | undefined {
  const word = text.trim().split(/\s+/)[0]?.toLowerCase()
  return COMMANDS.find((c) => c.name === word)
}

// command list groups, in display order
export type CommandGroup = 'twitch' | 'app' | 'streamerbot'
export const COMMAND_GROUPS: CommandGroup[] = ['twitch', 'app', 'streamerbot']

export interface CommandInfo {
  /** What has to be typed to match. */
  name: string
  usage: string
  description: string
  group: CommandGroup
  /** What picking it puts in the box, if different from `name`. */
  insert?: string
}

const FIXED: CommandInfo[] = [
  ...TWITCH_COMMANDS.map((c) => ({ ...c, group: 'twitch' as const })),
  ...COMMANDS.map((c) => ({ name: c.name, usage: c.name, description: c.description, group: 'app' as const }))
]

/** `/sb Action name [text for the action]` runs a Streamer.bot action. */
export const SB_PREFIX = '/sb'

/** SB actions and chat commands as list entries. Disabled ones are skipped. */
export function streamerbotCommands(sb: StreamerbotState): CommandInfo[] {
  if (sb.status !== 'connected') return []
  const actions = sb.actions.filter((a) => a.enabled).map((a): CommandInfo => ({
    name: `${SB_PREFIX} ${a.name}`, usage: `${SB_PREFIX} ${a.name}`, group: 'streamerbot',
    description: a.group ? `Run this action in Streamer.bot · ${a.group}` : 'Run this action in Streamer.bot'
  }))
  const chat = sb.commands.filter((c) => c.enabled).map((c): CommandInfo => ({
    name: c.commands[0], usage: c.commands.join('  '), group: 'streamerbot', insert: c.commands[0],
    description: `Chat command${c.name && c.name !== c.commands[0] ? ` "${c.name}"` : ''}: sent to chat, and Streamer.bot runs it when it sees it there`
  }))
  return [...actions, ...chat]
}

export const allCommands = (sb: StreamerbotState): CommandInfo[] => [...FIXED, ...streamerbotCommands(sb)]

/** Autocomplete suggestions for what's been typed so far. */
export function matchCommands(text: string, sb: StreamerbotState): CommandInfo[] {
  const t = text.trimStart().toLowerCase()
  const sbList = streamerbotCommands(sb)
  // "/sb " followed by part of an action name
  if (t.startsWith(`${SB_PREFIX} `)) {
    return sbList.filter((c) => c.name.startsWith(SB_PREFIX) && c.name.toLowerCase().startsWith(t) && c.name.toLowerCase() !== t.trimEnd()).slice(0, 8)
  }
  // stop suggesting once there's a space after the command (picked one, or typing arguments)
  if (/\s/.test(t)) return []
  if (t.startsWith('!')) return sbList.filter((c) => !c.name.startsWith('/') && c.usage.toLowerCase().split(/\s+/).some((w) => w.startsWith(t))).slice(0, 8)
  if (!t.startsWith('/')) return []
  return [...FIXED, ...sbList].filter((c) => c.name.toLowerCase().startsWith(t)).slice(0, 8)
}

export const isTwitchCommand = (text: string): boolean => TWITCH_COMMAND_NAMES.has(text.trim().split(/\s+/)[0]?.toLowerCase() ?? '')

export const isSbCommand = (text: string): boolean => text.trim().split(/\s+/)[0]?.toLowerCase() === SB_PREFIX

/**
 * Which action a `/sb ...` line names, and the text after it. Longest name wins, so "Scene" and
 * "Scene Two" can both exist.
 */
export function findSbAction(text: string, actions: SbAction[]): { action: SbAction; input: string } | null {
  const rest = text.trim().slice(SB_PREFIX.length).trim()
  const lower = rest.toLowerCase()
  let best: SbAction | null = null
  for (const a of actions) {
    const name = a.name.toLowerCase()
    if ((lower === name || lower.startsWith(`${name} `)) && (!best || a.name.length > best.name.length)) best = a
  }
  return best ? { action: best, input: rest.slice(best.name.length).trim() } : null
}
