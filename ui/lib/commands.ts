import { TWITCH_COMMANDS, TWITCH_COMMAND_NAMES } from '../../shared/twitch-commands'
import { clearHistory } from './store'

/** Commands typed in the message box. They run in the app and are never sent to a platform. */
export interface Command {
  name: string
  description: string
  /** Returns the line shown to the user afterwards. */
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

/** The command a message starts with, if it is one of the app's own. */
export function findCommand(text: string): Command | undefined {
  const word = text.trim().split(/\s+/)[0]?.toLowerCase()
  return COMMANDS.find((c) => c.name === word)
}

/** One entry in the commands list: the app's own, or a Twitch command. */
export interface CommandInfo { name: string; usage: string; description: string; twitch?: boolean; app?: boolean }

export const ALL_COMMANDS: CommandInfo[] = [
  ...COMMANDS.map((c) => ({ name: c.name, usage: c.name, description: c.description, app: true })),
  ...TWITCH_COMMANDS.map((c) => ({ ...c, twitch: true }))
]

/** Commands matching what has been typed so far, for suggestions. */
export function matchCommands(text: string): CommandInfo[] {
  // Once a space follows the command name (after picking one, or typing its arguments), stop suggesting.
  const t = text.trimStart().toLowerCase()
  if (!t.startsWith('/') || /\s/.test(t)) return []
  return ALL_COMMANDS.filter((c) => c.name.startsWith(t)).slice(0, 8)
}

/** True when the first word is a Twitch command the app runs. */
export const isTwitchCommand = (text: string): boolean => TWITCH_COMMAND_NAMES.has(text.trim().split(/\s+/)[0]?.toLowerCase() ?? '')
