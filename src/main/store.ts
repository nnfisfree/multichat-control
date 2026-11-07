import { app, safeStorage } from 'electron'
import { existsSync, readFileSync, renameSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { DEFAULT_SETTINGS, type SecretState, type Settings } from '../shared/types'

function readJson<T>(file: string, fallback: T): T {
  try {
    return existsSync(file) ? { ...fallback, ...JSON.parse(readFileSync(file, 'utf8')) } : fallback
  } catch {
    return fallback
  }
}

/** Writes through a temp file so a crash cannot leave a half-written store behind. */
function writeJson(file: string, value: unknown): void {
  const tmp = `${file}.tmp`
  writeFileSync(tmp, JSON.stringify(value, null, 2))
  renameSync(tmp, file)
}

class Store {
  private settingsFile = ''
  private secretsFile = ''
  private secretsData: Record<string, string> = {}
  settings: Settings = DEFAULT_SETTINGS

  load(): void {
    const dir = app.getPath('userData')
    this.settingsFile = join(dir, 'settings.json')
    this.secretsFile = join(dir, 'secrets.json')
    this.settings = readJson(this.settingsFile, DEFAULT_SETTINGS)
    this.secretsData = readJson<Record<string, string>>(this.secretsFile, {})
  }

  saveSettings(patch: Partial<Settings>): Settings {
    this.settings = { ...this.settings, ...patch }
    writeJson(this.settingsFile, this.settings)
    return this.settings
  }

  /** Secrets are encrypted to the current Windows user, so a copied data folder won't unlock them. */
  getSecret(key: string): string | undefined {
    const raw = this.secretsData[key]
    if (!raw) return undefined
    try {
      return safeStorage.decryptString(Buffer.from(raw, 'base64'))
    } catch {
      return undefined
    }
  }

  setSecret(key: string, value: string | undefined): void {
    if (value) {
      if (!safeStorage.isEncryptionAvailable()) throw new Error('Windows secure storage is unavailable.')
      this.secretsData[key] = safeStorage.encryptString(value).toString('base64')
    } else delete this.secretsData[key]
    writeJson(this.secretsFile, this.secretsData)
  }

  secretState(): SecretState {
    return { youtubeSecret: !!this.getSecret('youtube.clientSecret'), kickSecret: !!this.getSecret('kick.clientSecret') }
  }
}

export const store = new Store()
