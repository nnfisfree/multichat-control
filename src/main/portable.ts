import { app } from 'electron'
import { accessSync, constants, cpSync, existsSync, mkdirSync, renameSync } from 'node:fs'
import { dirname, join } from 'node:path'

/** The data folder beside the exe. Development builds use a hidden one in the project. */
const DATA_FOLDER = 'user-data'
/** The name used up to version 0.1.2, moved to the new name on first start. */
const OLD_FOLDER = 'nnf-data'

/**
 * Moves data from the old folder name, so people updating keep their logins, settings, events
 * and chat history. Logins stay readable: Windows ties their encryption to the user, not the folder.
 */
function moveOldData(oldDir: string, dir: string): void {
  if (existsSync(dir) || !existsSync(oldDir)) return
  try {
    renameSync(oldDir, dir)
  } catch {
    // Renaming can fail if something still holds a file open; a copy keeps everything anyway.
    try {
      cpSync(oldDir, dir, { recursive: true })
    } catch {
      // Nothing more to try: the app starts with a fresh folder and the old one stays untouched.
    }
  }
}

/**
 * Keeps all app data in `user-data` beside the exe. The portable exe runs from a temp folder,
 * so its real location comes from electron-builder's PORTABLE_EXECUTABLE_* variables.
 * Must run before the app is ready.
 */
export function usePortableData(): string {
  const exeDir = process.env.PORTABLE_EXECUTABLE_DIR
    || (process.env.PORTABLE_EXECUTABLE_FILE && dirname(process.env.PORTABLE_EXECUTABLE_FILE))
    || (app.isPackaged ? dirname(process.execPath) : process.cwd())
  const hidden = app.isPackaged ? '' : '.'
  const dir = join(exeDir, `${hidden}${DATA_FOLDER}`)
  moveOldData(join(exeDir, `${hidden}${OLD_FOLDER}`), dir)
  try {
    mkdirSync(dir, { recursive: true })
    accessSync(dir, constants.W_OK)
  } catch {
    // Read-only location, such as a locked USB drive: keep working from the default profile.
    return app.getPath('userData')
  }
  app.setPath('userData', dir)
  app.setPath('sessionData', join(dir, 'session'))
  return dir
}
