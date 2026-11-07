import { BrowserWindow, app, ipcMain, session, shell } from 'electron'
import { join } from 'node:path'
import { TWITCH_CLIENT_ID } from '../shared/app-config'
import { safeUrl } from '../shared/parts'
import { PLATFORMS, type Bootstrap, type PanelBounds, type Platform, type Settings } from '../shared/types'
import { DemoConnector } from './demo'
import { Hub } from './hub'
import type { Connector } from './platforms/connector'
import { KickConnector } from './platforms/kick/connector'
import { TwitchConnector } from './platforms/twitch/connector'
import { YouTubeConnector } from './platforms/youtube/connector'
import { usePortableData } from './portable'
import { store } from './store'
import { TwitchPanel } from './twitch-panel'

const dataDir = usePortableData()
const demo = process.argv.includes('--demo')
const demoRate = Number(process.argv.find((a) => a.startsWith('--demo-rate='))?.split('=')[1]) || 60

const MIN_OPACITY = 0.05

const hub = new Hub()
let win: BrowserWindow | null = null
let twitch: TwitchConnector | null = null
let panel: TwitchPanel

function openExternal(url: string): void {
  const safe = safeUrl(url)
  if (safe) void shell.openExternal(safe)
}

function applyOpacity(): void {
  win?.setOpacity(Math.max(MIN_OPACITY, Math.min(1, store.settings.windowOpacity)))
}

function createWindow(): void {
  win = new BrowserWindow({
    width: 1120,
    height: 900,
    minWidth: 420,
    minHeight: 480,
    frame: false,
    show: false,
    backgroundColor: '#150a3c',
    title: 'NNF MultiChat',
    webPreferences: { preload: join(__dirname, '../preload/index.js'), contextIsolation: true, sandbox: true, nodeIntegration: false }
  })
  applyOpacity()
  win.once('ready-to-show', () => win?.show())
  win.on('closed', () => { win = null })
  // The renderer is a local page: it must never navigate or open windows itself.
  win.webContents.on('will-navigate', (e) => e.preventDefault())
  win.webContents.setWindowOpenHandler(({ url }) => {
    openExternal(url)
    return { action: 'deny' }
  })
  hub.attach(win)
  const dev = process.env.ELECTRON_RENDERER_URL
  if (dev) void win.loadURL(dev)
  else void win.loadFile(join(__dirname, '../renderer/index.html'))
}

function buildConnectors(): void {
  for (const p of PLATFORMS) {
    const ctx = hub.context(p)
    let c: Connector
    if (demo) c = new DemoConnector(p, ctx, demoRate / 3)
    else if (p === 'twitch') c = twitch = new TwitchConnector(ctx)
    else if (p === 'youtube') c = new YouTubeConnector(ctx)
    else c = new KickConnector(ctx)
    hub.register(c)
  }
}

function registerIpc(): void {
  const handle = (ch: string, fn: (...args: any[]) => unknown): void => {
    ipcMain.handle(ch, (e, ...args) => {
      // Only the app's own window may call in; the panel's page never can.
      if (!win || e.sender !== win.webContents) throw new Error('Unauthorized sender.')
      return fn(...args)
    })
  }
  handle('bootstrap', (): Bootstrap => ({
    settings: store.settings,
    secrets: store.secretState(),
    ...hub.snapshot(),
    demo,
    builtInTwitchId: !!TWITCH_CLIENT_ID,
    dataDir,
    version: app.getVersion()
  }))
  handle('send', (targets: Platform[], text: string, replyTo) => hub.send(targets, text, replyTo))
  handle('moderate', (p: Platform, req) => hub.moderate(p, req))
  handle('emotes', (p: Platform) => hub.get(p).emotes())
  handle('actions', (p: Platform) => hub.get(p).actions())
  handle('runAction', (p: Platform, id: string, args) => hub.runAction(p, id, args))
  handle('login', (p: Platform) => hub.get(p).login())
  handle('logout', (p: Platform) => hub.get(p).logout())
  handle('reconnect', async (p: Platform) => {
    await hub.get(p).stop()
    await hub.get(p).start()
  })
  handle('saveSettings', async (patch: Partial<Settings>) => {
    const before = store.settings
    const next = store.saveSettings(patch)
    if (patch.windowOpacity !== undefined) applyOpacity()
    if (patch.emoteProviders) await hub.refreshEmotes()
    const restart = async (p: Platform): Promise<void> => {
      await hub.get(p).stop()
      await hub.get(p).start()
    }
    if (!demo && before.twitchClientId !== next.twitchClientId) await restart('twitch')
    if (!demo && before.youtubeClientId !== next.youtubeClientId) await restart('youtube')
    if (!demo && before.kickClientId !== next.kickClientId) await restart('kick')
    return next
  })
  handle('saveSecret', async (key: 'youtubeSecret' | 'kickSecret', value: string) => {
    const platform: Platform = key === 'youtubeSecret' ? 'youtube' : 'kick'
    store.setSecret(`${platform}.clientSecret`, value)
    if (!demo) {
      await hub.get(platform).stop()
      await hub.get(platform).start()
    }
    return store.secretState()
  })
  handle('openExternal', openExternal)
  handle('showPanel', (b: PanelBounds) => panel.show(b))
  handle('hidePanel', () => panel.hide())
  handle('panelRewardsOnly', (on: boolean) => panel.setRewardsOnly(on))
  handle('popOutPanel', () => panel.popOut())
  ipcMain.on('window', (e, action: string) => {
    if (!win || e.sender !== win.webContents) return
    if (action === 'minimize') win.minimize()
    else if (action === 'close') win.close()
    else if (action === 'maximize') win.isMaximized() ? win.unmaximize() : win.maximize()
  })
}

if (!app.requestSingleInstanceLock()) app.quit()
else {
  app.on('second-instance', () => {
    if (win?.isMinimized()) win.restore()
    // Opening the app again rescues a window left almost invisible.
    store.saveSettings({ windowOpacity: 1 })
    applyOpacity()
    win?.webContents.send('settings:changed', store.settings)
    win?.focus()
  })

  void app.whenReady().then(async () => {
    store.load()
    // Listing installed fonts is the only permission the app itself needs.
    session.defaultSession.setPermissionRequestHandler((_c, p, done) => done((p as string) === 'local-fonts'))
    session.defaultSession.setPermissionCheckHandler((_c, p) => (p as string) === 'local-fonts')
    panel = new TwitchPanel(() => win, () => twitch?.channelLogin())
    buildConnectors()
    registerIpc()
    createWindow()
    await hub.startAll()
  })

  app.on('window-all-closed', () => app.quit())
  app.on('before-quit', () => {
    panel?.destroy()
    void hub.stopAll()
  })
}
