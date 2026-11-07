import { BrowserWindow, Menu, Tray, app, dialog } from 'electron'
import { APP_NAME } from '../shared/app-config'
import type { CloseAction } from '../shared/types'
import { store } from './store'

interface Options {
  window(): BrowserWindow | null
  iconPath: string
  /** Tells the UI a remembered choice changed the settings. */
  settingsChanged(): void
}

/** Decides what the X button does: exit, hide to the tray, or ask. */
export class CloseToTray {
  private tray: Tray | null = null
  private quitting = false
  private asking = false

  constructor(private o: Options) {
    app.on('before-quit', () => { this.quitting = true })
  }

  attach(win: BrowserWindow): void {
    win.on('close', (e) => {
      if (this.quitting) return
      const action = store.settings.closeAction
      if (action === 'exit') return
      e.preventDefault()
      if (action === 'tray') this.hide()
      else void this.ask()
    })
    // Windows is shutting down, so nothing may block the close.
    win.on('session-end', () => { this.quitting = true })
  }

  private async ask(): Promise<void> {
    const win = this.o.window()
    if (!win || this.asking) return
    this.asking = true
    const { response, checkboxChecked } = await dialog.showMessageBox(win, {
      type: 'question',
      title: APP_NAME,
      message: 'Close the app or keep it running in the tray?',
      detail: 'In the tray, chat stays connected in the background.',
      buttons: ['Minimize to tray', 'Exit', 'Cancel'],
      defaultId: 0,
      cancelId: 2,
      checkboxLabel: 'Remember my choice',
      noLink: true
    })
    this.asking = false
    if (response === 2) return
    const choice: CloseAction = response === 0 ? 'tray' : 'exit'
    if (checkboxChecked) {
      store.saveSettings({ closeAction: choice })
      this.o.settingsChanged()
    }
    if (choice === 'tray') this.hide()
    else app.quit()
  }

  private hide(): void {
    this.ensureTray()
    this.o.window()?.hide()
  }

  show(): void {
    const win = this.o.window()
    if (!win) return
    if (win.isMinimized()) win.restore()
    win.show()
    win.focus()
  }

  private ensureTray(): void {
    if (this.tray) return
    this.tray = new Tray(this.o.iconPath)
    this.tray.setToolTip(APP_NAME)
    this.tray.setContextMenu(Menu.buildFromTemplate([
      { label: 'Open', click: () => this.show() },
      { type: 'separator' },
      { label: 'Exit', click: () => app.quit() }
    ]))
    this.tray.on('click', () => this.show())
  }
}
