import { BrowserWindow, Session, WebContents, WebContentsView, session, shell } from 'electron'
import { safeUrl } from '../shared/parts'
import type { ActionResult, PanelBounds } from '../shared/types'

const PARTITION = 'persist:twitch-panel'
// Twitch's sign-in can reject Electron's default user agent, so present plain Chrome.
const USER_AGENT = (ua: string): string => ua.replace(/\s*Electron\/\S+/, '').replace(/\s*[a-z-]+\/\d\S*\s*(?=Chrome)/i, ' ')

/**
 * While rewards-only is on, everything except Twitch's rewards popover is hidden and the popover
 * fills the view. `visibility` is used because a visible child can sit inside a hidden parent.
 */
const ISOLATE_CSS = `
html.nnf-pending body { opacity: 0 !important; }
html.nnf-rewards body * { visibility: hidden !important; }
html.nnf-rewards .nnf-root, html.nnf-rewards .nnf-root * { visibility: visible !important; }
html.nnf-rewards, html.nnf-rewards body { background: #18181b !important; overflow: hidden !important; }
html.nnf-rewards .nnf-flat { transform: none !important; overflow: visible !important; contain: none !important; filter: none !important; }
html.nnf-rewards .nnf-root { position: fixed !important; inset: 0 !important; width: 100vw !important; height: 100vh !important; max-width: none !important; max-height: none !important; margin: 0 !important; transform: none !important; z-index: 2147483647 !important; }
html.nnf-rewards .nnf-root > *, html.nnf-rewards .nnf-root > * > *, html.nnf-rewards .nnf-root > * > * > *, html.nnf-rewards .nnf-root .reward-center__content { width: 100% !important; height: 100% !important; max-width: none !important; max-height: none !important; }
html.nnf-rewards .nnf-root .reward-center-body { max-height: none !important; }
html.nnf-rewards .nnf-root :focus { outline: none !important; box-shadow: none !important; }
`

/**
 * Keeps the popover open and isolated. If it can't be found within a few seconds, such as when
 * signed out, the whole page is shown so the user can still sign in or accept Twitch's prompts.
 */
const ISOLATE_JS = `(() => {
  if (window.__nnfPanel) return
  const root = document.documentElement
  const state = window.__nnfPanel = { rewardsOnly: true, started: Date.now(), lastClick: 0 }
  const balance = () => {
    const box = document.querySelector('.chat-input__buttons-container')
    if (!box) return null
    const buttons = [...box.querySelectorAll('button')]
    return buttons.find((b) => /points|bits/i.test(b.getAttribute('aria-label') || '') && b.getAttribute('data-a-target') !== 'bits-button')
      || buttons.find((b) => !b.getAttribute('data-a-target') && /\\d/.test(b.innerText))
  }
  const clear = () => {
    root.classList.remove('nnf-rewards', 'nnf-pending')
    document.querySelectorAll('.nnf-root, .nnf-flat').forEach((e) => e.classList.remove('nnf-root', 'nnf-flat'))
  }
  const tick = () => {
    if (!state.rewardsOnly) return clear()
    const content = document.querySelector('.reward-center__content')
    const dialog = content && content.closest('[role="dialog"]')
    if (dialog) {
      if (!dialog.classList.contains('nnf-root')) {
        clear()
        dialog.classList.add('nnf-root')
        for (let n = dialog.parentElement; n && n !== document.body; n = n.parentElement) n.classList.add('nnf-flat')
      }
      root.classList.remove('nnf-pending')
      root.classList.add('nnf-rewards')
      state.started = Date.now()
      return
    }
    root.classList.remove('nnf-rewards')
    const button = balance()
    if (button && Date.now() - state.lastClick > 1500) {
      state.lastClick = Date.now()
      button.click()
    }
    if (Date.now() - state.started > 6000) root.classList.remove('nnf-pending')
    else if (!document.querySelector('[data-a-target="consent-banner-accept"]')) root.classList.add('nnf-pending')
    else root.classList.remove('nnf-pending')
  }
  setInterval(tick, 400)
  tick()
})()`

const isTwitch = (url: string): boolean => {
  try {
    const { protocol, hostname } = new URL(url)
    return protocol === 'https:' && (hostname === 'twitch.tv' || hostname.endsWith('.twitch.tv'))
  } catch {
    return false
  }
}

function lockToTwitch(contents: WebContents, parent: () => BrowserWindow | null): void {
  contents.on('will-navigate', (e, url) => {
    if (isTwitch(url)) return
    e.preventDefault()
    const safe = safeUrl(url)
    if (safe) void shell.openExternal(safe)
  })
  contents.setWindowOpenHandler(({ url }) => {
    if (isTwitch(url)) {
      const p = parent()
      return { action: 'allow', overrideBrowserWindowOptions: { parent: p ?? undefined, width: 520, height: 720, autoHideMenuBar: true, webPreferences: { partition: PARTITION, sandbox: true } } }
    }
    const safe = safeUrl(url)
    if (safe) void shell.openExternal(safe)
    return { action: 'deny' }
  })
}

/**
 * Shows Twitch's own chat page, which is the only way to reach the real Power-ups & Rewards
 * panel. It is an isolated site session: it never sees the app's tokens, and its only contact
 * with the app is being positioned over the flyout.
 */
export class TwitchPanel {
  private view: WebContentsView | null = null
  private ses: Session | null = null
  private shown = false
  private rewardsOnly = true

  constructor(private window: () => BrowserWindow | null, private channel: () => string | undefined) {}

  private url(): string | null {
    const login = this.channel()
    return login ? `https://www.twitch.tv/popout/${encodeURIComponent(login)}/chat?darkpopout` : null
  }

  private session(): Session {
    if (!this.ses) {
      this.ses = session.fromPartition(PARTITION)
      this.ses.setUserAgent(USER_AGENT(this.ses.getUserAgent()))
      // The panel needs no device access, so everything is refused.
      this.ses.setPermissionRequestHandler((_c, _p, done) => done(false))
    }
    return this.ses
  }

  private applyMode(): void {
    void this.view?.webContents.executeJavaScript(`window.__nnfPanel && (window.__nnfPanel.rewardsOnly = ${this.rewardsOnly}, window.__nnfPanel.started = Date.now())`).catch(() => {})
  }

  private isolate(contents: WebContents): void {
    void contents.insertCSS(ISOLATE_CSS).catch(() => {})
    void contents.executeJavaScript(ISOLATE_JS).then(() => this.applyMode()).catch(() => {})
  }

  show(bounds: PanelBounds): ActionResult {
    const win = this.window()
    const url = this.url()
    if (!win) return { ok: false, message: 'Window is closed.' }
    if (!url) return { ok: false, message: 'Log in to Twitch first, so the app knows which channel to open.' }
    if (!this.view) {
      this.view = new WebContentsView({ webPreferences: { session: this.session(), sandbox: true, contextIsolation: true } })
      this.view.setBackgroundColor('#18181b')
      const contents = this.view.webContents
      lockToTwitch(contents, this.window)
      contents.on('dom-ready', () => this.isolate(contents))
      void contents.loadURL(url)
    }
    this.view.setBounds(bounds)
    if (!this.shown) win.contentView.addChildView(this.view)
    this.shown = true
    return { ok: true }
  }

  hide(): void {
    if (this.view && this.shown) this.window()?.contentView.removeChildView(this.view)
    this.shown = false
  }

  /** Some rewards need typing in chat, so the full page stays one click away. */
  setRewardsOnly(on: boolean): void {
    this.rewardsOnly = on
    this.applyMode()
  }

  /** Fallback when embedding fails: the same page and session in its own window. */
  popOut(): ActionResult {
    const url = this.url()
    if (!url) return { ok: false, message: 'Log in to Twitch first, so the app knows which channel to open.' }
    const child = new BrowserWindow({ width: 460, height: 760, title: 'Twitch Rewards', autoHideMenuBar: true, webPreferences: { session: this.session(), sandbox: true } })
    lockToTwitch(child.webContents, () => child)
    void child.loadURL(url)
    return { ok: true }
  }

  destroy(): void {
    this.view?.webContents.close()
    this.view = null
  }
}
