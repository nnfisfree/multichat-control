import { invoke } from '@tauri-apps/api/core'
import { listen } from '@tauri-apps/api/event'
import { getCurrentWindow } from '@tauri-apps/api/window'
import {
  ALERT_SOURCES, PLATFORMS, type Bootstrap, type PickedAlertSource, type HubBatch, type NnfApi, type ObsState, type StreamerbotState,
  type PanelBounds, type Platform, type Settings, type UpdateState
} from '../shared/types'
import { ChatLog } from './chat-log'
import { core, onAuthChanged } from './core'
import { DEMO_STREAMERBOT, DemoConnector, demoHistory, demoPreview, startDemoObs } from './demo'
import { loadEvents, loadRemoved, saveEvents, saveRemoved } from './event-log'
import { Hub } from './hub'
import { BuyMeACoffee } from './integrations/buymeacoffee'
import { StreamElements } from './integrations/streamelements'
import { Streamlabs } from './integrations/streamlabs'
import { log } from './log'
import { ObsLink } from './obs'
import { StreamlabsLink } from './streamlabs'
import { MeldLink } from './meld'
import { Previews } from './previews'
import type { Connector } from './platforms/connector'
import { KickConnector } from './platforms/kick/connector'
import { TikTokConnector } from './platforms/tiktok/connector'
import { TwitchConnector } from './platforms/twitch/connector'
import { YouTubeConnector } from './platforms/youtube/connector'
import { ALERTS_READY } from '../shared/app-config'
import { loadStore, store } from './store'
import { StreamerbotLink } from './streamerbot'

/** Passed in from Rust on startup. */
interface AppInfo { demo: boolean; version: string; dataDir: string }

/** The UI listens for this to show the close / keep-in-tray prompt. */
export const CLOSE_ASK_EVENT = 'nnf:close-ask'

/**
 * Builds the engine and hangs it on window.nnf. Chat, alerts and OBS run here in the webview;
 * Rust owns logins, files and the window itself.
 */
export async function startEngine(): Promise<void> {
  const info = await invoke<AppInfo>('app_info')
  const demo = info.demo
  await loadStore()

  const hub = new Hub()
  const batchListeners = new Set<(b: HubBatch) => void>()
  const settingsListeners = new Set<(s: Settings) => void>()
  const obsListeners = new Set<(s: ObsState) => void>()
  const sbListeners = new Set<(s: StreamerbotState) => void>()
  const updateListeners = new Set<(s: UpdateState) => void>()
  const panelListeners = new Set<(v: boolean) => void>()
  const on = <T>(set: Set<(v: T) => void>) => (cb: (v: T) => void) => { set.add(cb); return () => { set.delete(cb) } }
  const tell = <T>(set: Set<(v: T) => void>, v: T): void => { for (const cb of set) cb(v) }
  hub.attach((batch) => tell(batchListeners, batch))

  // Demo mode never touches the real history files.
  const chatLog = new ChatLog(() => store.settings.keepChatHistory)
  if (!demo) {
    const [events, removed] = await Promise.all([loadEvents(), loadRemoved()])
    hub.restoreEvents(events, saveEvents)
    hub.restoreRemoved(removed, saveRemoved)
    await chatLog.init()
    hub.record(chatLog)
  }

  let twitch: TwitchConnector | null = null
  const connectors = new Map<Platform, Connector>()
  for (const p of PLATFORMS) {
    const ctx = hub.context(p)
    const c: Connector = demo ? new DemoConnector(p, ctx, 20)
      : p === 'twitch' ? (twitch = new TwitchConnector(ctx))
      : p === 'youtube' ? new YouTubeConnector(ctx)
      : p === 'kick' ? new KickConnector(ctx)
      : new TikTokConnector(ctx)
    connectors.set(p, c)
    hub.register(c)
  }

  // Link preview cards. Demo mode fakes them so nothing goes out over the network.
  const previews = new Previews((id) => twitch?.clipPreview(id) ?? Promise.resolve(null), demo ? demoPreview : undefined)

  // Only the alert service the user picked gets started.
  const alerts = {
    streamelements: new StreamElements(hub.alertContext('streamelements')),
    streamlabs: new Streamlabs(hub.alertContext('streamlabs'))
  }
  // BMC runs next to whichever service is picked, as long as a token is saved. It doesn't need
  // anyone's approval, so ALERTS_READY doesn't gate it.
  const bmc = new BuyMeACoffee(hub.alertContext('buymeacoffee'), demo)
  void bmc.start().catch(() => {})
  const startAlerts = async (): Promise<void> => {
    for (const s of ALERT_SOURCES) {
      if (ALERTS_READY && s === store.settings.alertService && !demo) await alerts[s].start().catch(() => {})
      else {
        alerts[s].stop()
        hub.alertContext(s).status({ status: 'off' })
      }
    }
  }

  // Rust noticed a token got revoked or expired.
  await onAuthChanged(({ service, loggedIn }) => {
    if (service === 'buymeacoffee') {
      if (!loggedIn) bmc.stop()
      return
    }
    if (loggedIn) return
    const c = connectors.get(service as Platform) as { loginEnded?: () => Promise<void> } | undefined
    if (c?.loginEnded) void c.loginEnded()
    else if (service === store.settings.alertService) alerts[service as PickedAlertSource].stop()
  })

  // OBS (fake stats in demo mode)
  let obsState: ObsState = { status: 'off' } as ObsState
  const sendObs = (s: ObsState): void => { obsState = s; tell(obsListeners, s) }
  // one link per streaming app; only the picked one runs
  const links = { obs: new ObsLink(sendObs), streamlabs: new StreamlabsLink(sendObs), meld: new MeldLink(sendObs) }
  const obs = {
    start: (): void => {
      for (const l of Object.values(links)) l.stop()
      ;(links[store.settings.streamApp] ?? links.obs).start()
    },
    stop: (): void => { for (const l of Object.values(links)) l.stop() }
  }

  // Streamer.bot actions and commands, kept in sync with whatever is set up there
  let sbState: StreamerbotState = { status: 'off', actions: [], commands: [] }
  const sendSb = (s: StreamerbotState): void => { sbState = s; tell(sbListeners, s) }
  const sb = new StreamerbotLink(sendSb, (e) => hub.testEvent(e))
  const startSb = (): void => {
    if (!demo) return sb.start()
    sendSb(store.settings.sbEnabled ? DEMO_STREAMERBOT : { status: 'off', actions: [], commands: [] })
  }

  // Updater, Twitch panel sign-in and window state all live on the Rust side.
  let update: UpdateState = await invoke<UpdateState>('update_state').catch(() => ({ status: 'idle' } as UpdateState))
  let panelSignedIn = await invoke<boolean | null>('panel_signed_in').catch(() => null)
  await listen<UpdateState>('update:state', (e) => { update = e.payload; tell(updateListeners, e.payload) })
  await listen<boolean>('panel:signedIn', (e) => { panelSignedIn = e.payload; tell(panelListeners, e.payload) })
  let secrets = await core.secretState()
  const builtIn = await core.builtInLogins()

  const applyOpacity = (): Promise<void> => invoke('window_opacity', { value: store.settings.windowOpacity })
  const applyWobble = (): Promise<void> => invoke('window_wobble', { enabled: store.settings.windowWobble, intensity: store.settings.wobbleIntensity })
  const saveSettings = (patch: Partial<Settings>): Settings => {
    const next = store.saveSettings(patch)
    tell(settingsListeners, next)
    return next
  }

  // Flush whatever is pending before quitting. A failing step is skipped; Rust force-closes after
  // a few seconds anyway.
  let quitting: Promise<void> | null = null
  const quit = (): Promise<void> => (quitting ??= (async () => {
    log('app', 'closing')
    await invoke('app_quitting').catch(() => {})
    const step = (name: string, run: () => void): void => {
      try { run() } catch (err) { log('app', `closing: ${name} failed: ${String(err)}`) }
    }
    step('chat history', () => chatLog.flush())
    for (const s of ALERT_SOURCES) step(s, () => alerts[s].stop())
    step('buymeacoffee', () => bmc.stop())
    step('obs', () => obs.stop())
    step('streamerbot', () => sb.stop())
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
  // Launching it a second time resets the opacity, in case someone faded the window to nothing.
  await listen('app:second-instance', () => { saveSettings({ windowOpacity: 1 }); void applyOpacity() })

  const win = getCurrentWindow()
  const restart = async (p: Platform): Promise<void> => {
    await hub.get(p).stop()
    await hub.get(p).start()
  }

  const api: NnfApi = {
    bootstrap: async (): Promise<Bootstrap> => ({
      settings: store.settings,
      secrets: await core.secretState().catch(() => secrets),
      ...hub.snapshot(),
      demo,
      builtInTwitchId: true,
      builtInYoutube: builtIn.youtube,
      builtInKick: builtIn.kick,
      dataDir: info.dataDir,
      version: info.version,
      update,
      obs: obsState,
      streamerbot: sbState,
      panelSignedIn
    }),
    onBatch: on(batchListeners),
    onSettings: on(settingsListeners),
    onObs: on(obsListeners),
    onStreamerbot: on(sbListeners),
    onUpdate: on(updateListeners),
    onPanelSignedIn: on(panelListeners),
    send: (targets, text, replyTo) => hub.send(targets, text, replyTo),
    moderate: (p, req) => hub.moderate(p, req),
    automod: (id, allow) => hub.automod(String(id ?? ''), allow === true),
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
      if (patch.windowWobble !== undefined || patch.wobbleIntensity !== undefined) await applyWobble()
      if (patch.emoteProviders) await hub.refreshEmotes()
      // turning history off wipes the saved log as well
      if (patch.keepChatHistory === false && !demo) chatLog.clear()
      if (!demo && (before.obsEnabled !== next.obsEnabled || before.obsPort !== next.obsPort || before.streamApp !== next.streamApp || before.slPort !== next.slPort || before.meldPort !== next.meldPort)) obs.start()
      if (before.sbEnabled !== next.sbEnabled || before.sbPort !== next.sbPort) startSb()
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
    stats: (p) => hub.stats(p),
    userCard: (p, u) => hub.userCard(p, { id: String(u?.id ?? ''), name: String(u?.name ?? ''), login: u?.login, color: u?.color }),
    twitchCommand: (text) => hub.twitchCommand(String(text ?? '')),
    linkPreview: (url) => previews.get(String(url ?? '')),
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
        if (source === 'buymeacoffee') throw new Error('Paste your Buy Me a Coffee token to connect.')
        if (!ALERT_SOURCES.includes(source) || demo || !ALERTS_READY) throw new Error('Not available yet.')
        await alerts[source].login()
      },
      logout: async (source) => {
        if (source === 'buymeacoffee') bmc.logout()
        else if (ALERT_SOURCES.includes(source)) alerts[source].logout()
      },
      reconnect: async (source) => {
        if (source === 'buymeacoffee') await bmc.start()
        else if (ALERT_SOURCES.includes(source) && !demo) await alerts[source].start()
      },
      connect: async (source, token) => {
        if (source !== 'buymeacoffee') throw new Error('This service logs in through the browser.')
        if (demo) throw new Error('Not available in demo mode.')
        await bmc.connect(String(token ?? ''))
      }
    },
    tiktok: {
      connect: async (username, key) => {
        if (demo) throw new Error('Not available in demo mode.')
        const room = await core.tiktokRoom(String(username ?? ''))
        if (typeof key === 'string' && key.trim()) await core.tiktokKey(key.trim())
        secrets = await core.secretState()
        if (!secrets.tiktokKey) throw new Error('Paste your free Euler Stream key too. TikTok chat can only be read with one.')
        saveSettings({ tiktokUsername: room.handle })
        await restart('tiktok')
        return secrets
      },
      disconnect: async () => {
        await hub.get('tiktok').logout()
        await core.tiktokKey(null).catch(() => null)
        saveSettings({ tiktokUsername: '' })
        secrets = await core.secretState()
        return secrets
      }
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
      setStreamlabsToken: async (token) => {
        const state = await core.saveSecret('slToken', typeof token === 'string' && token ? token : null)
        if (!demo) obs.start()
        return state
      },
      reconnect: async () => { if (!demo) obs.start() }
    },
    streamerbot: {
      setPassword: async (password) => {
        const state = await core.saveSecret('sbPassword', typeof password === 'string' && password ? password : null)
        startSb()
        return state
      },
      reconnect: async () => startSb(),
      run: async (id, input) => {
        if (!demo) return sb.runAction(String(id ?? ''), typeof input === 'string' ? input : undefined)
        const action = DEMO_STREAMERBOT.actions.find((a) => a.id === id)
        return action ? { ok: true, message: `Ran "${action.name}" in Streamer.bot.` } : { ok: false, message: 'That action is no longer in Streamer.bot.' }
      }
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
      // through Rust, same path as Alt+F4
      else void invoke('window_close').catch(() => closeAsked())
    }
  }
  // Close-prompt answers, called from the UI.
  ;(window as unknown as { nnfClose: unknown }).nnfClose = {
    tray: (remember: boolean) => { if (remember) saveSettings({ closeAction: 'tray' }); void invoke('window_to_tray') },
    exit: (remember: boolean) => { if (remember) saveSettings({ closeAction: 'exit' }); void quit() }
  }
  window.nnf = api

  await applyOpacity().catch(() => {})
  await applyWobble().catch(() => {})
  if (demo) startDemoObs(sendObs)
  else obs.start()
  startSb()
  // demo builds never self-update
  if (!demo) void invoke('update_start').catch(() => {})
  log('app', `started ${info.version}${demo ? ' in demo mode' : ''}`)
  void Promise.all([hub.startAll(), startAlerts()])
}
