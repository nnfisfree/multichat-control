import { app, shell } from 'electron'
import { spawn } from 'node:child_process'
import { createHash } from 'node:crypto'
import { createWriteStream, existsSync, mkdirSync, readdirSync, rmSync, unlinkSync, writeFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { UPDATE_REPO } from '../shared/app-config'
import type { UpdateInfo, UpdateState } from '../shared/types'
import { compareVersions } from '../shared/version'
import { log } from './log'
import { message } from './net'
import { store } from './store'

const CHECK_EVERY_MS = 6 * 60 * 60 * 1000
const FIRST_CHECK_MS = 15 * 1000
const EXE = 'Multichat-Control.exe'

/**
 * Where releases are read from. A localhost address may replace GitHub, only so the whole
 * update flow can be tested offline; no other address is ever accepted.
 */
function apiBase(): string {
  const override = process.env.MULTICHAT_UPDATE_API
  return override && /^http:\/\/127\.0\.0\.1:\d+$/.test(override) ? override : 'https://api.github.com'
}

/** How this copy runs decides which file an update replaces. */
function install(): { kind: 'portable' | 'folder'; target: string; exe: string } | null {
  if (!app.isPackaged) return null
  const portable = process.env.PORTABLE_EXECUTABLE_FILE
  if (portable) return { kind: 'portable', target: portable, exe: portable }
  return { kind: 'folder', target: dirname(process.execPath), exe: process.execPath }
}

/** Batch files need % doubled, and paths are always quoted. */
const cmdText = (s: string): string => s.replace(/%/g, '%%')

/**
 * A plain Windows batch file that waits for the app to close, copies the new files over the old
 * ones (never touching the user-data folder, or nnf-data from older versions), then reopens the app. Batch files run on every Windows PC,
 * with no PowerShell policy involved, and the user sees a short "Updating" window.
 */
function helperScript(o: { pid: number; kind: 'portable' | 'folder'; source: string; target: string; exe: string; log: string }): string {
  const q = (s: string): string => `"${cmdText(s)}"`
  const copy = o.kind === 'portable'
    ? `copy /y ${q(o.source)} ${q(o.target)} >nul 2>&1 && goto done`
    : `robocopy ${q(o.source)} ${q(o.target)} /E /R:2 /W:1 /XD user-data nnf-data /NFL /NDL /NJH /NJS /NP >nul 2>&1\r\nif %errorlevel% lss 8 goto done`
  return [
    '@echo off',
    'title Updating Multichat Control',
    'echo Updating Multichat Control. Please wait, it reopens by itself.',
    `set "LOG=${cmdText(o.log)}"`,
    'echo %date% %time% waiting for the app to close>>"%LOG%"',
    ':wait',
    `tasklist /FI "PID eq ${o.pid}" 2>nul | find "${o.pid}" >nul`,
    'if not errorlevel 1 (ping -n 2 127.0.0.1 >nul & goto wait)',
    'set /a tries=0',
    ':copy',
    'set /a tries+=1',
    copy,
    'if %tries% geq 30 goto failed',
    'ping -n 3 127.0.0.1 >nul',
    'goto copy',
    ':done',
    'echo %date% %time% files replaced>>"%LOG%"',
    'goto start',
    ':failed',
    'echo %date% %time% update failed; the previous version is unchanged>>"%LOG%"',
    ':start',
    `start "" ${q(o.exe)}`,
    'echo %date% %time% app restarted>>"%LOG%"',
    'exit /b',
    ''
  ].join('\r\n')
}

export class Updater {
  private state: UpdateState = { status: 'idle', current: app.getVersion() }
  private timer: NodeJS.Timeout | null = null
  private downloaded: { kind: 'portable' | 'folder'; source: string } | null = null

  constructor(private send: (state: UpdateState) => void) {}

  get(): UpdateState {
    return this.state
  }

  private set(patch: Partial<UpdateState>): void {
    this.state = { ...this.state, ...patch }
    this.send(this.state)
  }

  start(): void {
    setTimeout(() => {
      if (store.settings.autoUpdate) void this.check(false)
    }, FIRST_CHECK_MS)
    this.timer = setInterval(() => {
      if (store.settings.autoUpdate && this.state.status !== 'downloading' && this.state.status !== 'ready') void this.check(false)
    }, CHECK_EVERY_MS)
  }

  stop(): void {
    if (this.timer) clearInterval(this.timer)
  }

  /** Finds the newest release this copy can install. Only GitHub is contacted. */
  async check(manual: boolean): Promise<UpdateState> {
    if (this.state.status === 'downloading' || this.state.status === 'ready') return this.state
    this.set({ status: 'checking', error: undefined })
    try {
      const res = await fetch(`${apiBase()}/repos/${UPDATE_REPO}/releases?per_page=15`, {
        headers: { Accept: 'application/vnd.github+json', 'User-Agent': 'multichat-control-updater' },
        signal: AbortSignal.timeout(15000)
      })
      if (!res.ok) throw new Error(res.status === 404 ? 'No public releases found.' : `GitHub answered ${res.status}.`)
      const releases: any[] = await res.json()
      const where = install()
      const newest = releases
        .filter((r) => !r.draft && (store.settings.updatePrereleases || !r.prerelease))
        .filter((r) => compareVersions(r.tag_name, this.state.current) > 0)
        .sort((a, b) => compareVersions(b.tag_name, a.tag_name))[0]
      if (!newest) {
        this.set({ status: 'none', info: undefined, checkedAt: Date.now() })
        return this.state
      }
      const wanted = where?.kind === 'portable' ? /-portable\.exe$/i : /-x64\.zip$/i
      const asset = (newest.assets ?? []).find((a: any) => wanted.test(a.name))
      const sha256 = /^sha256:([0-9a-f]{64})$/i.exec(asset?.digest ?? '')?.[1]?.toLowerCase()
      const info: UpdateInfo = {
        version: String(newest.tag_name).replace(/^v/i, ''),
        notes: String(newest.body ?? '').slice(0, 20000),
        page: newest.html_url,
        // Only files with a checksum from GitHub may be installed automatically.
        canInstall: !!(where && asset && sha256),
        size: asset?.size
      }
      this.downloadUrl = asset?.browser_download_url
      this.expectedSha = sha256
      log('update', `found ${info.version}${info.canInstall ? '' : ' (manual install only)'}`)
      this.set({ status: 'available', info, checkedAt: Date.now() })
    } catch (err) {
      log('update', `check failed: ${message(err)}`)
      // Background checks stay quiet; only a manual check shows the error.
      this.set(manual ? { status: 'error', error: message(err) } : { status: 'idle' })
    }
    return this.state
  }

  private downloadUrl: string | undefined
  private expectedSha: string | undefined

  /** Downloads, checks the file against GitHub's checksum, and prepares it. */
  async download(): Promise<void> {
    const where = install()
    const info = this.state.info
    if (!where || !info?.canInstall || !this.downloadUrl || !this.expectedSha) return this.fail('This update has to be installed from the download page.')
    if (!this.writable(where.kind === 'portable' ? dirname(where.target) : where.target)) {
      return this.fail('The app is in a protected folder, so it can\'t update itself. Use the download page, or move the app to a folder like Documents.')
    }
    const dir = join(app.getPath('temp'), `multichat-update-${info.version}`)
    rmSync(dir, { recursive: true, force: true })
    mkdirSync(dir, { recursive: true })
    const file = join(dir, where.kind === 'portable' ? EXE : 'update.zip')
    this.set({ status: 'downloading', progress: 0 })
    try {
      const res = await fetch(this.downloadUrl, { headers: { 'User-Agent': 'multichat-control-updater' } })
      if (!res.ok || !res.body) throw new Error(`Download failed (${res.status}).`)
      const total = Number(res.headers.get('content-length')) || info.size || 0
      const hash = createHash('sha256')
      const out = createWriteStream(file)
      let got = 0
      let shown = 0
      const reader = res.body.getReader()
      for (;;) {
        const { done, value } = await reader.read()
        if (done) break
        hash.update(value)
        if (!out.write(value)) await new Promise((r) => out.once('drain', r))
        got += value.length
        const pct = total ? Math.floor((got / total) * 100) : 0
        if (pct !== shown) {
          shown = pct
          this.set({ progress: pct })
        }
      }
      await new Promise<void>((resolve, reject) => out.end((err?: Error | null) => (err ? reject(err) : resolve())))
      if (hash.digest('hex') !== this.expectedSha) throw new Error('The download doesn\'t match GitHub\'s checksum, so it was discarded.')
      let source = file
      if (where.kind === 'folder') {
        source = join(dir, 'app')
        await this.unzip(file, source)
        if (!existsSync(join(source, EXE)) || !existsSync(join(source, 'resources', 'app.asar'))) throw new Error('The update is missing app files.')
        unlinkSync(file)
      }
      this.downloaded = { kind: where.kind, source }
      log('update', `${info.version} downloaded and verified`)
      this.set({ status: 'ready', progress: 100 })
    } catch (err) {
      rmSync(dir, { recursive: true, force: true })
      this.fail(message(err))
    }
  }

  /** Closes the app, lets the helper swap the files, and starts the new version. */
  installAndRestart(): void {
    const where = install()
    if (!where || !this.downloaded || this.state.status !== 'ready') return
    const helper = join(dirname(this.downloaded.source), 'install-update.cmd')
    const logFile = join(app.getPath('userData'), 'logs', 'update.log')
    mkdirSync(dirname(logFile), { recursive: true })
    writeFileSync(helper, helperScript({ pid: process.pid, kind: where.kind, source: this.downloaded.source, target: where.target, exe: where.exe, log: logFile }))
    log('update', `installing ${this.state.info?.version}`)
    // Opened the way a double-click would, so Windows owns the helper and it outlives the app.
    void shell.openPath(helper).then((err) => {
      if (err) return this.fail(`The updater couldn't start: ${err}`)
      log('update', 'helper started')
      app.quit()
    })
  }

  openPage(): void {
    void shell.openExternal(this.state.info?.page ?? `https://github.com/${UPDATE_REPO}/releases/latest`)
  }

  private fail(error: string): void {
    log('update', `failed: ${error}`)
    this.set({ status: 'error', error, progress: undefined })
  }

  private writable(dir: string): boolean {
    try {
      const probe = join(dir, `.update-check-${process.pid}`)
      writeFileSync(probe, '')
      unlinkSync(probe)
      return true
    } catch {
      return false
    }
  }

  private unzip(zip: string, to: string): Promise<void> {
    return new Promise((resolve, reject) => {
      const p = spawn('powershell.exe', ['-NoProfile', '-NonInteractive', '-Command', `Expand-Archive -LiteralPath '${zip.replace(/'/g, "''")}' -DestinationPath '${to.replace(/'/g, "''")}' -Force`], { windowsHide: true })
      p.on('error', reject)
      p.on('exit', (code) => (code === 0 && existsSync(to) && readdirSync(to).length ? resolve() : reject(new Error('The update couldn\'t be unpacked.'))))
    })
  }
}
