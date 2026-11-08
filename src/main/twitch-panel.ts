import { BrowserWindow, Session, WebContents, WebContentsView, session, shell } from 'electron'
import { safeUrl } from '../shared/parts'
import type { ActionResult, PanelBounds } from '../shared/types'

const PARTITION = 'persist:twitch-panel'
// Twitch's sign-in can reject Electron's default user agent, so present plain Chrome.
const USER_AGENT = (ua: string): string => ua.replace(/\s*Electron\/\S+/, '').replace(/\s*[a-z-]+\/\d\S*\s*(?=Chrome)/i, ' ')

/**
 * Everything except Twitch's rewards popover is hidden, and the popover fills the view.
 * `visibility` is used because a visible child can sit inside a hidden parent. Twitch's own
 * dialogs and modals, such as a confirmation or Bits purchase, stay visible and clickable.
 */
const ISOLATE_CSS = `
html.nnf-rewards body * { visibility: hidden !important; }
html.nnf-rewards .nnf-root, html.nnf-rewards .nnf-root * { visibility: visible !important; }
html.nnf-rewards [role="dialog"]:not(.nnf-root), html.nnf-rewards [role="dialog"]:not(.nnf-root) *,
html.nnf-rewards .ReactModalPortal, html.nnf-rewards .ReactModalPortal *,
html.nnf-rewards [role="tooltip"], html.nnf-rewards [role="tooltip"] * { visibility: visible !important; }
html.nnf-rewards .ReactModalPortal { position: relative; z-index: 2147483647; }
html.nnf-rewards, html.nnf-rewards body { background: #120d5c !important; overflow: hidden !important; }
html.nnf-rewards .nnf-root, html.nnf-rewards .nnf-fill { background: transparent !important; border-radius: 0 !important; }
html.nnf-rewards .nnf-root .reward-center__content { background: linear-gradient(135deg, #090b3f, #120d5c 45%, #1e1180 75%, #163a9c) !important; border-radius: 0 !important; }
html.nnf-rewards .nnf-flat { transform: none !important; overflow: visible !important; contain: none !important; filter: none !important; }
html.nnf-rewards .nnf-root { position: fixed !important; inset: 0 !important; width: 100vw !important; height: 100vh !important; max-width: none !important; max-height: none !important; margin: 0 !important; transform: none !important; z-index: 2147483646 !important; }
html.nnf-rewards .nnf-fill { width: 100% !important; height: 100% !important; max-width: none !important; max-height: none !important; }
html.nnf-rewards .nnf-root .reward-center-body { max-height: none !important; }
html.nnf-rewards .nnf-root :focus { outline: none !important; box-shadow: none !important; }
html.nnf-rewards .rewards-popover-header button[aria-label="Close"] { display: none !important; }
#nnf-notice { position: fixed; inset: 0; display: grid; place-content: center; gap: 14px; padding: 24px; text-align: center; font: 15px 'Segoe UI', sans-serif; color: #efeff1; background: linear-gradient(135deg, #090b3f, #120d5c 45%, #1e1180 75%, #163a9c); z-index: 2147483647; }
#nnf-notice button { justify-self: center; padding: 8px 18px; font: 600 14px 'Segoe UI', sans-serif; color: #fff; background: #9147ff; border: 0; border-radius: 8px; cursor: pointer; }
#nnf-notice button:hover { background: #a970ff; }
`

/**
 * Opens the popover only when the panel opens, never while the user is busy in it, so the app
 * can't fight Twitch over clicks. If Twitch closes the popover, an Open button brings it back.
 * Signed out, the whole page shows, because Twitch's sign-in lives there.
 */
const ISOLATE_JS = `(() => {
  if (window.__nnfPanel) return
  const root = document.documentElement
  const state = window.__nnfPanel = { loadedAt: Date.now(), autoUntil: Date.now() + 10000, lastInput: 0, lastClick: 0 }
  const input = () => { state.lastInput = Date.now() }
  document.addEventListener('pointerdown', input, true)
  document.addEventListener('keydown', input, true)
  const balance = () => {
    const box = document.querySelector('.chat-input__buttons-container')
    if (!box) return null
    const buttons = [...box.querySelectorAll('button')]
    return buttons.find((b) => /points|bits/i.test(b.getAttribute('aria-label') || '') && b.getAttribute('data-a-target') !== 'bits-button')
      || buttons.find((b) => !b.getAttribute('data-a-target') && /\\d/.test(b.innerText))
  }
  const openPopover = () => {
    const button = balance()
    if (!button || Date.now() - state.lastClick < 2000) return
    state.lastClick = Date.now()
    button.click()
  }
  state.open = () => { state.autoUntil = Date.now() + 8000 }
  const notice = (text, withButton) => {
    let box = document.getElementById('nnf-notice')
    if (!text) return box && box.remove()
    if (!box) {
      box = document.createElement('div')
      box.id = 'nnf-notice'
      root.appendChild(box)
    }
    if (box.dataset.text === text) return
    box.dataset.text = text
    box.replaceChildren()
    const p = document.createElement('div')
    p.textContent = text
    box.appendChild(p)
    if (withButton) {
      const b = document.createElement('button')
      b.textContent = 'Open Rewards & Power-ups'
      b.addEventListener('click', () => { state.lastClick = 0; state.autoUntil = Date.now() + 5000; openPopover() })
      box.appendChild(b)
    }
  }
  const isolate = (dialog, content) => {
    if (!dialog.classList.contains('nnf-root')) {
      document.querySelectorAll('.nnf-root, .nnf-flat, .nnf-fill').forEach((e) => e.classList.remove('nnf-root', 'nnf-flat', 'nnf-fill'))
      dialog.classList.add('nnf-root')
      for (let n = dialog.parentElement; n && n !== document.body; n = n.parentElement) n.classList.add('nnf-flat')
    }
    // Twitch rebuilds the popover's inside after opening, so the stretch is reapplied every time.
    // Only the chain down to the rewards content stretches, so no other layer can cover the tiles.
    for (let n = content; n && n !== dialog; n = n.parentElement) n.classList.add('nnf-fill')
  }
  const tick = () => {
    const content = document.querySelector('.reward-center__content')
    const dialog = content && content.closest('[role="dialog"]')
    if (dialog) {
      isolate(dialog, content)
      root.classList.add('nnf-rewards')
      notice(null)
      return
    }
    const button = balance()
    if (!button) {
      // Signed out, or Twitch is still loading: after a moment, show the page so sign-in is possible.
      const consent = document.querySelector('[data-a-target="consent-banner-accept"]')
      if (consent || Date.now() - state.loadedAt > 6000) { root.classList.remove('nnf-rewards'); notice(null) }
      else notice('Loading Twitch…', false)
      return
    }
    root.classList.remove('nnf-rewards')
    const userBusy = Date.now() - state.lastInput < 1500
    if (Date.now() < state.autoUntil && !userBusy) {
      notice('Opening Rewards & Power-ups…', false)
      openPopover()
    } else notice('Rewards & Power-ups closed.', true)
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

  private isolate(contents: WebContents): void {
    void contents.insertCSS(ISOLATE_CSS).catch(() => {})
    void contents.executeJavaScript(ISOLATE_JS).catch(() => {})
  }

  show(bounds: PanelBounds): ActionResult {
    const win = this.window()
    const url = this.url()
    if (!win) return { ok: false, message: 'Window is closed.' }
    if (!url) return { ok: false, message: 'Log in to Twitch first, so the app knows which channel to open.' }
    if (!this.view) {
      this.view = new WebContentsView({ webPreferences: { session: this.session(), sandbox: true, contextIsolation: true } })
      this.view.setBackgroundColor('#120d5c')
      const contents = this.view.webContents
      lockToTwitch(contents, this.window)
      contents.on('dom-ready', () => this.isolate(contents))
      void contents.loadURL(url)
    }
    this.view.setBounds(bounds)
    if (!this.shown) {
      win.contentView.addChildView(this.view)
      // Each time the flyout opens, open the popover again in case Twitch closed it.
      void this.view.webContents.executeJavaScript('window.__nnfPanel && window.__nnfPanel.open()').catch(() => {})
    }
    this.shown = true
    return { ok: true }
  }

  hide(): void {
    if (this.view && this.shown) this.window()?.contentView.removeChildView(this.view)
    this.shown = false
  }

  destroy(): void {
    this.view?.webContents.close()
    this.view = null
  }
}
