import { useEffect, useRef, useState, type JSX } from 'react'
import { updateSettings, useStore } from '../lib/store'
import { YOUTUBE_NOTICE_EVENT, type YoutubeNoticeDetail } from '../lib/login'
import { Icon, PlatformIcon } from './Icons'

const REPO = 'https://github.com/nnfisfree/multichat-control'

/**
 * Shown before the YouTube login (see lib/login.ts). The app hasn't been through Google's review,
 * so Google warns "Google hasn't verified this app" and words the chat permission in its broadest
 * terms. This says why, what the app really does with it, and where to click.
 */
export function YoutubeNotice(): JSX.Element | null {
  const answer = useRef<YoutubeNoticeDetail | null>(null)
  const [open, setOpen] = useState(false)
  const linux = useStore((s) => s.boot?.platform === 'linux')
  const [hide, setHide] = useState(false)

  useEffect(() => {
    const show = (e: Event): void => {
      answer.current?.(false)
      answer.current = (e as CustomEvent<YoutubeNoticeDetail>).detail
      setHide(false)
      setOpen(true)
    }
    window.addEventListener(YOUTUBE_NOTICE_EVENT, show)
    return () => window.removeEventListener(YOUTUBE_NOTICE_EVENT, show)
  }, [])

  const close = (go: boolean): void => {
    setOpen(false)
    if (go && hide) void updateSettings({ youtubeNoticeSeen: true })
    answer.current?.(go)
    answer.current = null
  }

  useEffect(() => {
    if (!open) return
    const key = (e: KeyboardEvent): void => { if (e.key === 'Escape') close(false) }
    window.addEventListener('keydown', key)
    return () => window.removeEventListener('keydown', key)
  })

  if (!open) return null
  return (
    <div className="close-back yt-notice-back" role="presentation" onMouseDown={(e) => { if (e.target === e.currentTarget) close(false) }}>
      <div className="popover whats-new yt-notice" role="dialog" aria-modal="true" aria-labelledby="yt-notice-title">
        <header>
          <span className="pf youtube"><PlatformIcon platform="youtube" size={20} /></span>
          <h2 id="yt-notice-title">Before you log in to YouTube</h2>
        </header>

        <p className="yt-lead">
          Google will warn you that <b>"Google hasn't verified this app"</b> and call it <b>unsafe</b>. That's expected, and your account is safe.
        </p>

        <ul className="yt-why">
          <li>
            <span className="wn-icon" aria-hidden="true"><Icon.info /></span>
            <p><b>Why the warning?</b> Google shows it for any app that can use YouTube chat until the app has been through Google's review. Multichat Control is a free, open-source project made by one person, and that review isn't finished yet.</p>
          </li>
          <li>
            <span className="wn-icon" aria-hidden="true"><Icon.shield /></span>
            <p><b>What the app does with it.</b> Google describes the permission in broad words ("see, edit and delete your YouTube videos…") because chat comes in the same package. The app only reads your channel name, live stream and viewer count, and reads, sends and moderates <b>live chat</b>. It never touches your videos, comments or settings.</p>
          </li>
          <li>
            <span className="wn-icon" aria-hidden="true"><Icon.check /></span>
            <p><b>Your login stays with you.</b> It's saved on this PC, {linux ? 'encrypted with a key kept in your system keyring' : 'encrypted by Windows'}, and is never sent to us or anyone else. You can check every line of the <button className="linkish" onClick={() => void window.nnf.openExternal(REPO)}>source code</button>, and remove access any time in your Google account.</p>
          </li>
        </ul>

        <ol className="yt-steps" aria-label="How to continue on Google's page">
          <li><span className="yt-num">1</span>Pick your account, then click <span className="yt-g">Advanced</span></li>
          <li><span className="yt-num">2</span>Click <span className="yt-g link">Go to MultichatControl (unsafe)</span></li>
          <li><span className="yt-num">3</span>Click <span className="yt-g">Continue</span> to allow chat access</li>
        </ol>

        <p className="yt-foot">
          Google lets an unverified app sign in only 100 people. If Google says <b>"Access blocked"</b>, that limit has been reached: use your own free Google app instead, in <b>Settings → Connections → YouTube → Advanced</b>.
        </p>

        <div className="wn-foot yt-buttons">
          <label className="close-remember">
            <input type="checkbox" checked={hide} onChange={(e) => setHide(e.target.checked)} /> Don't show this again
          </label>
          <button className="btn ghost" onClick={() => close(false)}>Cancel</button>
          <button className="btn" autoFocus onClick={() => close(true)}>Continue to Google</button>
        </div>
      </div>
    </div>
  )
}
