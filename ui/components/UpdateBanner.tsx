import { useState, type JSX } from 'react'
import { useStore } from '../lib/store'

/** Shown under the title bar when a new version exists, and while it downloads. */
export function UpdateBanner(): JSX.Element | null {
  const u = useStore((s) => s.update)
  const [dismissed, setDismissed] = useState('')
  const [notes, setNotes] = useState(false)
  if (!u?.info) return null
  const v = u.info.version
  if (u.status === 'available' && dismissed === v) return null
  if (u.status !== 'available' && u.status !== 'downloading' && u.status !== 'ready' && !(u.status === 'error' && u.info)) return null

  return (
    <div className={`update-banner ${u.status}`} role="status">
      <div className="update-row">
        {u.status === 'available' && <>
          <span className="update-text"><b>Version {v} is available.</b> You have {u.current}.</span>
          <button className="linkish" onClick={() => setNotes(!notes)}>{notes ? 'Hide' : 'What\'s new'}</button>
          {u.info.canInstall
            ? <button className="btn" onClick={() => void window.nnf.updates.download()}>Update now</button>
            : <button className="btn" onClick={() => void window.nnf.updates.openPage()}>Download</button>}
          <button className="btn ghost" onClick={() => setDismissed(v)}>Later</button>
        </>}
        {u.status === 'downloading' && <>
          <span className="update-text">Downloading version {v}… {u.progress ?? 0}%</span>
          <div className="update-bar" role="progressbar" aria-valuenow={u.progress ?? 0} aria-valuemin={0} aria-valuemax={100}><i style={{ width: `${u.progress ?? 0}%` }} /></div>
        </>}
        {u.status === 'ready' && <>
          <span className="update-text"><b>Version {v} is ready.</b> The app restarts to finish. Your settings and logins are kept.</span>
          <button className="btn" onClick={() => void window.nnf.updates.install()}>Restart and update</button>
        </>}
        {u.status === 'error' && <>
          <span className="update-text bad">Update problem: {u.error}</span>
          <button className="btn" onClick={() => void window.nnf.updates.openPage()}>Open download page</button>
        </>}
      </div>
      {notes && u.status === 'available' && <pre className="update-notes">{u.info.notes || 'No release notes.'}</pre>}
    </div>
  )
}
