import type { JSX } from 'react'
import icon from '../../assets/icon.png'
import { APP_NAME } from '../../shared/app-config'
import { ObsStrip } from './ObsStrip'

export function TitleBar({ demo, onObsSettings }: { demo: boolean; onObsSettings?(): void }): JSX.Element {
  return (
    <header className="titlebar" data-tauri-drag-region>
      <img className="brand-icon" src={icon} alt="" />
      <span className="brand" data-tauri-drag-region>{APP_NAME}</span>
      {demo && <span className="demo-tag">DEMO</span>}
      {/* OBS stats, centred with room on both sides. */}
      <div className="title-status"><ObsStrip onFix={onObsSettings} /></div>
      <button className="win-btn" aria-label="Minimize" onClick={() => window.nnf.window('minimize')}>_</button>
      <button className="win-btn max" aria-label="Maximize" onClick={() => window.nnf.window('maximize')}><i className="box" /></button>
      <button className="win-btn close" aria-label="Close" onClick={() => window.nnf.window('close')}>X</button>
    </header>
  )
}
