import { BrowserWindow, app, ipcMain, session, shell } from 'electron'
import { join } from 'node:path'
import { APP_NAME, TWITCH_CLIENT_ID } from '../shared/app-config'
import { safeUrl } from '../shared/parts'
import { ALERT_SOURCES, PLATFORMS, type AlertSource, type Bootstrap, type PanelBounds, type Platform, type Settings } from '../shared/types'
import { CloseToTray } from './close-to-tray'
import { hasBuiltIn } from './credentials'
import { DemoConnector } from './demo'
import { ChatLog } from './chat-log'
import { demoHistory } from './demo'
import { loadEvents, loadRemoved, saveEvents, saveRemoved } from './event-log'
import { Hub } from './hub'
import { StreamElements } from './integrations/streamelements'
import { Streamlabs } from './integrations/streamlabs'
import type { Connector } from './platforms/connector'
import { KickConnector } from './platforms/kick/connector'
import { TwitchConnector } from './platforms/twitch/connector'
import { YouTubeConnector } from './platforms/youtube/connector'
import { usePortableData } from './portable'
import { store } from './store'
import { TwitchPanel } from './twitch-panel'
import { Updater } from './updater'

const dataDir = usePortableData()
const demo = process.argv.includes('--demo')
const demoRate = Number(process.argv.find((a) => a.startsWith('--demo-rate='))?.split('=')[1]) || 60

const MIN_OPACITY = 0.05
const iconPath = app.isPackaged ? join(process.resourcesPath, 'icon.png') : join(app.getAppPath(), 'resources/icon.png')

const hub = new Hub()
const chatLog = new ChatLog(() => store.settings.keepChatHistory)
/** Whether Twitch's rewards panel is signed in; null until known. */
let panelSignedIn: boolean | null = null
const alerts = {
  streamelements: new StreamElements(hub.alertContext('streamelements')),
  streamlabs: new Streamlabs(hub.alertContext('streamlabs'))
}
let win: BrowserWindow | null = null
let twitch: TwitchConnector | null = null
let panel: TwitchPanel
let closer: CloseToTray
const updater = new Updater((state) => win?.webContents.send('update:state', state))

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
    title: APP_NAME,
    icon: iconPath,
    webPreferences: { preload: join(__dirname, '../preload/index.js'), contextIsolation: true, sandbox: true, nodeIntegration: false }
  })
  applyOpacity()
  closer.attach(win)
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

/** Only the service the streamer picked runs; the other stays off. */
async function startAlerts(): Promise<void> {
  for (const s of ALERT_SOURCES) {
    if (s === store.settings.alertService && !demo) await alerts[s].start().catch(() => {})
    else {
      alerts[s].stop()
      hub.alertContext(s).status({ status: 'off' })
    }
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
    builtInYoutube: hasBuiltIn('youtube'),
    builtInKick: hasBuiltIn('kick'),
    dataDir,
    version: app.getVersion(),
    update: updater.get(),
    panelSignedIn
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
    // Turning history off also deletes what was saved.
    if (patch.keepChatHistory === false && !demo) chatLog.clear()
    const restart = async (p: Platform): Promise<void> => {
      await hub.get(p).stop()
      await hub.get(p).start()
    }
    if (!demo && before.twitchClientId !== next.twitchClientId) await restart('twitch')
    if (!demo && before.youtubeClientId !== next.youtubeClientId) await restart('youtube')
    if (!demo && before.kickClientId !== next.kickClientId) await restart('kick')
    if (before.alertService !== next.alertService) await startAlerts()
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
  handle('alerts:login', (source: AlertSource) => {
    if (!ALERT_SOURCES.includes(source) || demo) throw new Error('Not available here.')
    return alerts[source].login()
  })
  handle('alerts:logout', (source: AlertSource) => {
    if (ALERT_SOURCES.includes(source)) alerts[source].logout()
  })
  handle('alerts:reconnect', async (source: AlertSource) => {
    if (ALERT_SOURCES.includes(source) && !demo) await alerts[source].start()
  })
  // Demo mode shows invented past streams and never touches the real files.
  handle('history:sessions', () => (demo ? demoHistory.sessions() : chatLog.sessions()))
  handle('history:load', (id: string) => (demo ? demoHistory.load(id) : chatLog.load(String(id))))
  handle('history:clear', () => {
    hub.clearMessages()
    if (!demo) chatLog.clear()
    else demoHistory.clear()
  })
  handle('events:remove', (ids: string[]) => hub.removeEvents(Array.isArray(ids) ? ids : []))
  handle('openExternal', openExternal)
  handle('showPanel', (b: PanelBounds) => panel.show(b))
  handle('hidePanel', () => panel.hide())
  handle('update:check', () => updater.check(true))
  handle('update:download', () => updater.download())
  handle('update:install', () => updater.installAndRestart())
  handle('update:openPage', () => updater.openPage())
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
    closer.show()
    // Opening the app again rescues a window left almost invisible.
    store.saveSettings({ windowOpacity: 1 })
    applyOpacity()
    win?.webContents.send('settings:changed', store.settings)
  })

  void app.whenReady().then(async () => {
    store.load()
    // Demo mode keeps its invented events out of the saved list.
    if (!demo) {
      hub.restoreEvents(loadEvents(), saveEvents)
      hub.restoreRemoved(loadRemoved(), saveRemoved)
      chatLog.init()
      hub.record(chatLog)
    }
    // Listing installed fonts is the only permission the app itself needs.
    session.defaultSession.setPermissionRequestHandler((_c, p, done) => done((p as string) === 'local-fonts'))
    session.defaultSession.setPermissionCheckHandler((_c, p) => (p as string) === 'local-fonts')
    closer = new CloseToTray({
      window: () => win,
      iconPath,
      settingsChanged: () => win?.webContents.send('settings:changed', store.settings)
    })
    panel = new TwitchPanel(() => win, () => twitch?.channelLogin())
    panel.watch((signedIn) => {
      panelSignedIn = signedIn
      win?.webContents.send('panel:signedIn', signedIn)
    })
    buildConnectors()
    registerIpc()
    createWindow()
    // Demo copies are for trying the app, so they never update themselves.
    if (!demo) updater.start()
    await Promise.all([hub.startAll(), startAlerts()])
  })

  app.on('window-all-closed', () => app.quit())
  app.on('before-quit', () => {
    panel?.destroy()
    for (const s of ALERT_SOURCES) alerts[s].stop()
    chatLog.flush()
    void hub.stopAll()
  })
}
