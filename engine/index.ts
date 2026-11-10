import { invoke } from '@tauri-apps/api/core'
import { listen } from '@tauri-apps/api/event'
import { getCurrentWindow } from '@tauri-apps/api/window'
import {
  ALERT_SOURCES, PLATFORMS, type AlertSource, type Bootstrap, type HubBatch, type NnfApi, type ObsState,
  type PanelBounds, type Platform, type Settings, type UpdateState
} from '../shared/types'
import { ChatLog } from './chat-log'
import { core, onAuthChanged } from './core'
import { DemoConnector, demoHistory, startDemoObs } from './demo'
import { loadEvents, loadRemoved, saveEvents, saveRemoved } from './event-log'
import { Hub } from './hub'
import { StreamElements } from './integrations/streamelements'
import { Streamlabs } from './integrations/streamlabs'
import { log } from './log'
import { ObsLink } from './obs'
import type { Connector } from './platforms/connector'
import { KickConnector } from './platforms/kick/connector'
import { TwitchConnector } from './platforms/twitch/connector'
import { YouTubeConnector } from './platforms/youtube/connector'
import { loadStore, store } from './store'

/** What the Rust core tells the engine at start. */
interface AppInfo { demo: boolean; version: string; dataDir: string }

/** The interface listens for this to show the "close or keep in the tray?" question. */
export const CLOSE_ASK_EVENT = 'nnf:close-ask'

/**
 * Builds the engine and puts it where the interface expects it: window.nnf. The engine runs the
 * chats, alerts and OBS link in this page; the Rust core keeps logins, files and the window.
 */
export async function startEngine(): Promise<void> {
  const info = await invoke<AppInfo>('app_info')
  const demo = info.demo
  await loadStore()

  const hub = new Hub()
  const batchListeners = new Set<(b: HubBatch) => void>()
  const settingsListeners = new Set<(s: Settings) => void>()
  const obsListeners = new Set<(s: ObsState) => void>()
  const updateListeners = new Set<(s: UpdateState) => void>()
  const panelListeners = new Set<(v: boolean) => void>()
  const on = <T>(set: Set<(v: T) => void>) => (cb: (v: T) => void) => { set.add(cb); return () => { set.delete(cb) } }
  const tell = <T>(set: Set<(v: T) => void>, v: T): void => { for (const cb of set) cb(v) }
  hub.attach((batch) => tell(batchListeners, batch))

  // Saved events and chat history. Demo mode keeps its invented ones out of the real files.
  const chatLog = new ChatLog(() => store.settings.keepChatHistory)
  if (!demo) {
    const [events, removed] = await Promise.all([loadEvents(), loadRemoved()])
    hub.restoreEvents(events, saveEvents)
    hub.restoreRemoved(removed, saveRemoved)
    await chatLog.init()
    hub.record(chatLog)
  }

  // The platforms.
  let twitch: TwitchConnector | null = null
  const connectors = new Map<Platform, Connector>()
  for (const p of PLATFORMS) {
    const ctx = hub.context(p)
    const c: Connector = demo ? new DemoConnector(p, ctx, 20)
      : p === 'twitch' ? (twitch = new TwitchConnector(ctx))
      : p === 'youtube' ? new YouTubeConnector(ctx)
      : new KickConnector(ctx)
    connectors.set(p, c)
    hub.register(c)
  }

  // Alert services: only the one the streamer picked runs.
  const alerts = {
    streamelements: new StreamElements(hub.alertContext('streamelements')),
    streamlabs: new Streamlabs(hub.alertContext('streamlabs'))
  }
  const startAlerts = async (): Promise<void> => {
    for (const s of ALERT_SOURCES) {
      if (s === store.settings.alertService && !demo) await alerts[s].start().catch(() => {})
      else {
        alerts[s].stop()
        hub.alertContext(s).status({ status: 'off' })
      }
    }
  }

  // A login the core found gone (revoked or expired) stops that connection.
  await onAuthChanged(({ service, loggedIn }) => {
    if (loggedIn) return
    const c = connectors.get(service as Platform) as { loginEnded?: () => Promise<void> } | undefined
    if (c?.loginEnded) void c.loginEnded()
    else if (service === store.settings.alertService) alerts[service as AlertSource].stop()
  })

  // OBS: real stats, or invented ones in demo mode.
  let obsState: ObsState = { status: 'off' } as ObsState
  const sendObs = (s: ObsState): void => { obsState = s; tell(obsListeners, s) }
  const obs = new ObsLink(sendObs)

  // The rest lives in the core: the updater, the Twitch panel's sign-in, the window.
  let update: UpdateState = await invoke<UpdateState>('update_state').catch(() => ({ status: 'idle' } as UpdateState))
  let panelSignedIn = await invoke<boolean | null>('panel_signed_in').catch(() => null)
  await listen<UpdateState>('update:state', (e) => { update = e.payload; tell(updateListeners, e.payload) })
  await listen<boolean>('panel:signedIn', (e) => { panelSignedIn = e.payload; tell(panelListeners, e.payload) })
  const secrets = await core.secretState()
  const builtIn = await core.builtInLogins()

  const applyOpacity = (): Promise<void> => invoke('window_opacity', { value: store.settings.windowOpacity })
  const saveSettings = (patch: Partial<Settings>): Settings => {
    const next = store.saveSettings(patch)
    tell(settingsListeners, next)
    return next
  }

  // Shutting down: everything that's waiting is written first. A step that fails is skipped,
  // and the core closes the app within a few seconds whatever happens here.
  let quitting: Promise<void> | null = null
  const quit = (): Promise<void> => (quitting ??= (async () => {
    log('app', 'closing')
    await invoke('app_quitting').catch(() => {})
    const step = (name: string, run: () => void): void => {
      try { run() } catch (err) { log('app', `closing: ${name} failed: ${String(err)}`) }
    }
    step('chat history', () => chatLog.flush())
    for (const s of ALERT_SOURCES) step(s, () => alerts[s].stop())
    step('obs', () => obs.stop())
    await Promise.race([hub.stopAll().catch(() => {}), new Promise((r) => setTimeout(r, 1500))])
    await invoke('app_exit')
  })())
  const closeAsked = async (): Promise<void> => {
    const action = store.settings.closeAction
    log('app', `close requested (${action})`)
    try {
      if (action === 'exit') return await quit()
      if (action === 'tray') return await invoke('window_to_tray')
      window.dispatchEvent(new CustomEvent(CLOSE_ASK_EVENT))
    } catch (err) {
      log('app', `closing failed: ${String(err)}`)
      if (action !== 'tray') void quit()
    }
  }
  await listen('app:close-requested', () => void closeAsked())
  await listen('app:quit', () => void quit())
  // Opening the app again rescues a window left almost invisible.
  await listen('app:second-instance', () => { saveSettings({ windowOpacity: 1 }); void applyOpacity() })

  const win = getCurrentWindow()
  const restart = async (p: Platform): Promise<void> => {
    await hub.get(p).stop()
    await hub.get(p).start()
  }

  const api: NnfApi = {
    bootstrap: async (): Promise<Bootstrap> => ({
      settings: store.settings,
      secrets,
      ...hub.snapshot(),
      demo,
      builtInTwitchId: true,
      builtInYoutube: builtIn.youtube,
      builtInKick: builtIn.kick,
      dataDir: info.dataDir,
      version: info.version,
      update,
      obs: obsState,
      panelSignedIn
    }),
    onBatch: on(batchListeners),
    onSettings: on(settingsListeners),
    onObs: on(obsListeners),
    onUpdate: on(updateListeners),
    onPanelSignedIn: on(panelListeners),
    send: (targets, text, replyTo) => hub.send(targets, text, replyTo),
    moderate: (p, req) => hub.moderate(p, req),
    emotes: (p) => hub.get(p).emotes(),
    actions: (p) => hub.get(p).actions(),
    runAction: (p, id, args) => hub.runAction(p, id, args),
    login: (p) => hub.get(p).login(),
    logout: (p) => hub.get(p).logout(),
    reconnect: (p) => restart(p),
    saveSettings: async (patch) => {
      const before = store.settings
      const next = saveSettings(patch)
      if (patch.windowOpacity !== undefined) await applyOpacity()
      if (patch.emoteProviders) await hub.refreshEmotes()
      // Turning history off also deletes what was saved.
      if (patch.keepChatHistory === false && !demo) chatLog.clear()
      if (!demo && (before.obsEnabled !== next.obsEnabled || before.obsPort !== next.obsPort)) obs.start()
      if (!demo && before.twitchClientId !== next.twitchClientId) await restart('twitch')
      if (!demo && before.youtubeClientId !== next.youtubeClientId) await restart('youtube')
      if (!demo && before.kickClientId !== next.kickClientId) await restart('kick')
      if (before.alertService !== next.alertService) await startAlerts()
      return next
    },
    saveSecret: async (key, value) => {
      const state = await core.saveSecret(key, value.trim() || null)
      if (!demo) await restart(key === 'youtubeSecret' ? 'youtube' : 'kick')
      return state
    },
    removeEvents: async (ids) => hub.removeEvents(Array.isArray(ids) ? ids : []),
    users: (p) => hub.users(p),
    userCard: (p, u) => hub.userCard(p, { id: String(u?.id ?? ''), name: String(u?.name ?? ''), login: u?.login, color: u?.color }),
    twitchCommand: (text) => hub.twitchCommand(String(text ?? '')),
    history: {
      sessions: async () => (demo ? demoHistory.sessions() : chatLog.sessions()),
      load: async (id) => (demo ? demoHistory.load(id) : chatLog.load(String(id))),
      clear: async () => {
        hub.clearMessages()
        if (demo) demoHistory.clear()
        else chatLog.clear()
      }
    },
    alerts: {
      login: async (source) => {
        if (!ALERT_SOURCES.includes(source) || demo) throw new Error('Not available here.')
        await alerts[source].login()
      },
      logout: async (source) => { if (ALERT_SOURCES.includes(source)) alerts[source].logout() },
      reconnect: async (source) => { if (ALERT_SOURCES.includes(source) && !demo) await alerts[source].start() }
    },
    openExternal: async (url) => { await core.openUrl(url) },
    showPanel: (b: PanelBounds) => invoke('panel_show', { bounds: b, channel: twitch?.channelLogin() ?? null }),
    hidePanel: () => invoke('panel_hide'),
    obs: {
      setPassword: async (password) => {
        const state = await core.saveSecret('obsPassword', typeof password === 'string' && password ? password : null)
        if (!demo) obs.start()
        return state
      },
      reconnect: async () => { if (!demo) obs.start() }
    },
    updates: {
      check: () => invoke<UpdateState>('update_check', { manual: true }),
      download: () => invoke('update_download'),
      install: () => invoke('update_install'),
      openPage: () => invoke('update_open_page')
    },
    window: (action) => {
      if (action === 'minimize') void win.minimize()
      else if (action === 'maximize') void win.toggleMaximize()
      // Sent through the core, the same way as Alt+F4.
      else void invoke('window_close').catch(() => closeAsked())
    }
  }
  // The close question's answers, used by the interface.
  ;(window as unknown as { nnfClose: unknown }).nnfClose = {
    tray: (remember: boolean) => { if (remember) saveSettings({ closeAction: 'tray' }); void invoke('window_to_tray') },
    exit: (remember: boolean) => { if (remember) saveSettings({ closeAction: 'exit' }); void quit() }
  }
  window.nnf = api

  await applyOpacity().catch(() => {})
  if (demo) startDemoObs(sendObs)
  else obs.start()
  // Demo copies are for trying the app, so they never update themselves.
  if (!demo) void invoke('update_start').catch(() => {})
  log('app', `started ${info.version}${demo ? ' in demo mode' : ''}`)
  void Promise.all([hub.startAll(), startAlerts()])
}
