import { contextBridge, ipcRenderer } from 'electron'
import type { HubBatch, NnfApi, Settings, UpdateState } from '../shared/types'

const call = (ch: string) => (...args: unknown[]) => ipcRenderer.invoke(ch, ...args)

const api: NnfApi = {
  bootstrap: call('bootstrap') as NnfApi['bootstrap'],
  onBatch(cb) {
    const listener = (_e: unknown, batch: HubBatch): void => cb(batch)
    ipcRenderer.on('hub:batch', listener)
    return () => ipcRenderer.removeListener('hub:batch', listener)
  },
  send: call('send') as NnfApi['send'],
  moderate: call('moderate') as NnfApi['moderate'],
  emotes: call('emotes') as NnfApi['emotes'],
  actions: call('actions') as NnfApi['actions'],
  runAction: call('runAction') as NnfApi['runAction'],
  login: call('login') as NnfApi['login'],
  logout: call('logout') as NnfApi['logout'],
  reconnect: call('reconnect') as NnfApi['reconnect'],
  saveSettings: call('saveSettings') as NnfApi['saveSettings'],
  saveSecret: call('saveSecret') as NnfApi['saveSecret'],
  alerts: {
    login: call('alerts:login') as NnfApi['alerts']['login'],
    logout: call('alerts:logout') as NnfApi['alerts']['logout'],
    reconnect: call('alerts:reconnect') as NnfApi['alerts']['reconnect']
  },
  openExternal: call('openExternal') as NnfApi['openExternal'],
  showPanel: call('showPanel') as NnfApi['showPanel'],
  hidePanel: call('hidePanel') as NnfApi['hidePanel'],
  onUpdate(cb) {
    const listener = (_e: unknown, s: UpdateState): void => cb(s)
    ipcRenderer.on('update:state', listener)
    return () => ipcRenderer.removeListener('update:state', listener)
  },
  updates: {
    check: call('update:check') as NnfApi['updates']['check'],
    download: call('update:download') as NnfApi['updates']['download'],
    install: call('update:install') as NnfApi['updates']['install'],
    openPage: call('update:openPage') as NnfApi['updates']['openPage']
  },
  onSettings(cb) {
    const listener = (_e: unknown, s: Settings): void => cb(s)
    ipcRenderer.on('settings:changed', listener)
    return () => ipcRenderer.removeListener('settings:changed', listener)
  },
  window: (action) => ipcRenderer.send('window', action)
}

contextBridge.exposeInMainWorld('nnf', api)
