import { app } from 'electron'
import { accessSync, constants, mkdirSync } from 'node:fs'
import { dirname, join } from 'node:path'

/**
 * Keeps all app data in `nnf-data` beside the exe. The portable exe runs from a temp folder,
 * so its real location comes from electron-builder's PORTABLE_EXECUTABLE_* variables.
 * Must run before the app is ready.
 */
export function usePortableData(): string {
  const exeDir = process.env.PORTABLE_EXECUTABLE_DIR
    || (process.env.PORTABLE_EXECUTABLE_FILE && dirname(process.env.PORTABLE_EXECUTABLE_FILE))
    || (app.isPackaged ? dirname(process.execPath) : process.cwd())
  const dir = join(exeDir, app.isPackaged ? 'nnf-data' : '.nnf-data')
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
