import { contextBridge, ipcRenderer } from 'electron'
import type { HubBatch, NnfApi, Settings } from '../shared/types'

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
  openExternal: call('openExternal') as NnfApi['openExternal'],
  showPanel: call('showPanel') as NnfApi['showPanel'],
  hidePanel: call('hidePanel') as NnfApi['hidePanel'],
  panelRewardsOnly: call('panelRewardsOnly') as NnfApi['panelRewardsOnly'],
  onSettings(cb) {
    const listener = (_e: unknown, s: Settings): void => cb(s)
    ipcRenderer.on('settings:changed', listener)
    return () => ipcRenderer.removeListener('settings:changed', listener)
  },
  popOutPanel: call('popOutPanel') as NnfApi['popOutPanel'],
  window: (action) => ipcRenderer.send('window', action)
}

contextBridge.exposeInMainWorld('nnf', api)
