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

/** Commands matching what has been typed so far, for suggestions. */
export function matchCommands(text: string): Command[] {
  const t = text.trim().toLowerCase()
  if (!t.startsWith('/') || /\s/.test(t)) return []
  return COMMANDS.filter((c) => c.name.startsWith(t))
}
