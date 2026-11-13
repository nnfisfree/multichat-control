import type { JSX } from 'react'
import icon from '../../assets/icon.png'
import { APP_NAME } from '../../shared/app-config'
import { useStore } from '../lib/store'
import { ChannelStatsBar } from './ChannelStats'

export function TitleBar({ demo }: { demo: boolean }): JSX.Element {
  // The version the core reports, the same one Settings and the updater use.
  const version = useStore((s) => s.boot?.version ?? '')
  const showStats = useStore((s) => s.settings?.showStats ?? true)
  return (
    <header className="titlebar" data-tauri-drag-region>
      <div className="title-left" data-tauri-drag-region>
        <img className="brand-icon" src={icon} alt="" data-tauri-drag-region />
        <span className="brand" data-tauri-drag-region>
          {APP_NAME}
          {version && <span className="brand-version" data-tauri-drag-region>v{version}</span>}
        </span>
        {demo && <span className="demo-tag" data-tauri-drag-region>DEMO</span>}
      </div>
      {/* Channel stats, always in the very middle of the window, however many platforms show.
          Its empty space drags the window too. */}
      <div className="title-status" data-tauri-drag-region>{showStats && <ChannelStatsBar />}</div>
      <div className="title-right" data-tauri-drag-region>
        <button className="win-btn" aria-label="Minimize" onClick={() => window.nnf.window('minimize')}>_</button>
        <button className="win-btn max" aria-label="Maximize" onClick={() => window.nnf.window('maximize')}><i className="box" /></button>
        <button className="win-btn close" aria-label="Close" onClick={() => window.nnf.window('close')}>X</button>
      </div>
    </header>
  )
}
