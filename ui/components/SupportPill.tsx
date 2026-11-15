import type { JSX } from 'react'
import { BmcLogo } from './Icons'

export const BMC_URL = 'https://buymeacoffee.com/nnfisfree'

/**
 * "Support the project" button (Buy Me a Coffee). Colours come from the skin, and a soft shine runs
 * over it every few seconds so it gets noticed without being in the way. `big` is the Support page one.
 */
export function SupportPill({ big = false }: { big?: boolean }): JSX.Element {
  return (
    <button
      className={big ? 'support-pill big' : 'support-pill'}
      title="Buy me a coffee and support Multichat Control ☕"
      aria-label="Support Multichat Control on Buy Me a Coffee"
      onClick={() => void window.nnf.openExternal(BMC_URL)}
    >
      <span className="support-cup"><BmcLogo size={big ? 22 : 14} /></span>
      <span className="support-text">Support the project</span>
      {big && <span className="support-heart" aria-hidden="true">❤</span>}
    </button>
  )
}
