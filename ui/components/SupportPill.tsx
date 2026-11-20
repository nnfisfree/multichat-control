import type { JSX, MouseEvent } from 'react'
import { confettiBurst } from '../lib/confetti'

/**
 * Where every "support" button goes: GitHub Sponsors. Sponsors show up on the Support page by
 * themselves (scripts/update-supporters.mjs). Buy Me a Coffee is the streamer's own stream tip jar,
 * so the app no longer sends people there.
 */
export const SPONSOR_URL = 'https://github.com/sponsors/nnfisfree'
/** For people without a GitHub account. Never shown on the wall (see scripts/update-supporters.mjs). */
export const BMC_URL = 'https://buymeacoffee.com/nnfisfree'

/** GitHub's mark, in the text colour. */
export const GithubMark = ({ size = 13 }: { size?: number }): JSX.Element => (
  <svg className="gh-mark" width={size} height={size} viewBox="0 0 16 16" fill="currentColor" aria-hidden="true"><path d="M8 0C3.58 0 0 3.58 0 8c0 3.54 2.29 6.53 5.47 7.59.4.07.55-.17.55-.38 0-.19-.01-.82-.01-1.49-2.01.37-2.53-.49-2.69-.94-.09-.23-.48-.94-.82-1.13-.28-.15-.68-.52-.01-.53.63-.01 1.08.58 1.23.82.72 1.21 1.87.87 2.33.66.07-.52.28-.87.51-1.07-1.78-.2-3.64-.89-3.64-3.95 0-.87.31-1.59.82-2.15-.08-.2-.36-1.02.08-2.12 0 0 .67-.21 2.2.82.64-.18 1.32-.27 2-.27.68 0 1.36.09 2 .27 1.53-1.04 2.2-.82 2.2-.82.44 1.1.16 1.92.08 2.12.51.56.82 1.27.82 2.15 0 3.07-1.87 3.75-3.65 3.95.29.25.54.73.54 1.48 0 1.07-.01 1.93-.01 2.2 0 .21.15.46.55.38A8.013 8.013 0 0 0 16 8c0-4.42-3.58-8-8-8z" /></svg>
)

/** GitHub Sponsors' pink heart. */
export const SponsorHeart = ({ size = 16 }: { size?: number }): JSX.Element => (
  <svg className="sponsor-heart" width={size} height={size} viewBox="0 0 16 16" aria-hidden="true">
    <path fill="#db61a2" d="m8 14.25.345.666a.75.75 0 0 1-.69 0l-.008-.004-.018-.01a7.152 7.152 0 0 1-.31-.17 22.055 22.055 0 0 1-3.434-2.414C2.045 10.731 0 8.35 0 5.5 0 2.836 2.086 1 4.25 1 5.797 1 7.153 1.802 8 3.02 8.847 1.802 10.203 1 11.75 1 13.914 1 16 2.836 16 5.5c0 2.85-2.045 5.231-3.885 6.818a22.066 22.066 0 0 1-3.744 2.584l-.018.01-.006.003h-.002Z" />
  </svg>
)

// One confetti burst per real visit. A mouse resting on a button's very edge can leave and re-enter it
// many times a second (any hover movement makes that worse), so a burst needs the pointer to have been
// away for a moment, and there's at most one per 1.5 s per button.
const lastBurst = new WeakMap<Element, number>()
const lastLeave = new WeakMap<Element, number>()
const confettiOnEnter = (amount: number) => (e: MouseEvent<HTMLButtonElement>): void => {
  const el = e.currentTarget
  const now = Date.now()
  const left = lastLeave.get(el)
  if (now - (lastBurst.get(el) ?? 0) < 1500 || (left !== undefined && now - left < 400)) return
  lastBurst.set(el, now)
  const r = el.getBoundingClientRect()
  confettiBurst(r.left + r.width / 2, r.top + r.height / 2, amount)
}
const markLeave = (e: MouseEvent<HTMLButtonElement>): void => { lastLeave.set(e.currentTarget, Date.now()) }

/**
 * "Support the project" button (GitHub Sponsors). Colours come from the skin, and a soft shine runs
 * over it every few seconds so it gets noticed without being in the way. Hovering it pops a burst of
 * confetti. `big` is the Support page one.
 */
export function SupportPill({ big = false }: { big?: boolean }): JSX.Element {
  return (
    <button
      className={big ? 'support-pill big' : 'support-pill'}
      title="Sponsor Multichat Control on GitHub ❤"
      aria-label="Support Multichat Control on GitHub Sponsors"
      onMouseEnter={confettiOnEnter(big ? 150 : 110)}
      onMouseLeave={markLeave}
      onClick={() => void window.nnf.openExternal(SPONSOR_URL)}
    >
      <span className="support-cup"><SponsorHeart size={big ? 22 : 14} /></span>
      <span className="support-text">{big ? 'Sponsor on GitHub' : 'Support the project'}</span>
    </button>
  )
}

/** A plain heart in the current colour (Buy Me a Coffee button). */
const Heart = ({ size = 14 }: { size?: number }): JSX.Element => (
  <svg width={size} height={size} viewBox="0 0 16 16" fill="currentColor" aria-hidden="true"><path d="M8 14.6 6.9 13.6C3 10.1.5 7.8.5 5 .5 2.7 2.3 1 4.6 1c1.3 0 2.5.6 3.4 1.6C8.9 1.6 10.1 1 11.4 1 13.7 1 15.5 2.7 15.5 5c0 2.8-2.5 5.1-6.4 8.6L8 14.6z" /></svg>
)

/**
 * Under the message box: two small animated buttons instead of a text pill, so they take almost no
 * room. GitHub mark → GitHub Sponsors (shows on the wall), heart → Buy Me a Coffee. Confetti on hover.
 */
export function SupportIcons(): JSX.Element {
  const celebrate = confettiOnEnter(70)
  const go = (url: string) => (): void => void window.nnf.openExternal(url)
  return (
    <span className="support-icons">
      <button className="support-ico gh" title="Sponsor Multichat Control on GitHub" aria-label="Sponsor Multichat Control on GitHub" onMouseEnter={celebrate} onMouseLeave={markLeave} onClick={go(SPONSOR_URL)}>
        <GithubMark size={13} />
      </button>
      <button className="support-ico heart" title="Buy me a coffee ☕" aria-label="Support Multichat Control on Buy Me a Coffee" onMouseEnter={celebrate} onMouseLeave={markLeave} onClick={go(BMC_URL)}>
        <Heart size={13} />
      </button>
    </span>
  )
}
