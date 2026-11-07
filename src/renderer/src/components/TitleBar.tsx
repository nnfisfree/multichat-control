import type { JSX } from 'react'
import { APP_NAME } from '../../../shared/app-config'

export function TitleBar({ demo }: { demo: boolean }): JSX.Element {
  return (
    <header className="titlebar">
      <span className="brand">{APP_NAME}</span>
      {demo && <span className="demo-tag">DEMO</span>}
      <div className="grow" />
      <button className="win-btn" aria-label="Minimize" onClick={() => window.nnf.window('minimize')}>_</button>
      <button className="win-btn" aria-label="Maximize" onClick={() => window.nnf.window('maximize')}><i className="box" /></button>
      <button className="win-btn close" aria-label="Close" onClick={() => window.nnf.window('close')}>X</button>
    </header>
  )
}
