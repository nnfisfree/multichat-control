import { useEffect, useState, type JSX } from 'react'
import { PLATFORM_LABEL, type LinkPreview } from '../../shared/types'
import { PlatformIcon } from './Icons'

/** Answers already in, so rows scrolled back into view show their card at once. */
const known = new Map<string, { p: LinkPreview | null; at: number }>()
/** A link that had no card is asked about again after this long (it may need a login first). */
const RETRY_MS = 5 * 60 * 1000

function cached(url: string): LinkPreview | null | undefined {
  const k = known.get(url)
  if (!k || (!k.p && Date.now() - k.at > RETRY_MS)) return undefined
  return k.p
}

const duration = (s: number): string => {
  const t = Math.round(s)
  const h = Math.floor(t / 3600)
  const m = Math.floor((t % 3600) / 60)
  const sec = String(t % 60).padStart(2, '0')
  return h ? `${h}:${String(m).padStart(2, '0')}:${sec}` : `${m}:${sec}`
}

const views = (n: number): string =>
  `${new Intl.NumberFormat(undefined, { notation: 'compact', maximumFractionDigits: 1 }).format(n)} view${n === 1 ? '' : 's'}`

const KIND: Record<LinkPreview['kind'], string> = { video: 'Video', short: 'Short', clip: 'Clip' }

/** The card itself: picture with length, then title, channel and who clipped it. Opens the link on click. */
export function PreviewCard({ p }: { p: LinkPreview }): JSX.Element {
  const facts = [
    `${PLATFORM_LABEL[p.platform]} ${KIND[p.kind].toLowerCase()}`,
    p.clippedBy && `Clipped by ${p.clippedBy}`,
    p.views !== undefined && views(p.views)
  ].filter(Boolean).join(' · ')
  return (
    <a className={`lp lp-${p.platform}`} href={p.url} title={`${p.title}\n${p.url}`}
      onClick={(e) => { e.preventDefault(); e.stopPropagation(); void window.nnf.openExternal(p.url) }}>
      <span className="lp-thumb">
        {p.thumbnail && <img src={p.thumbnail} alt="" loading="lazy" decoding="async" referrerPolicy="no-referrer" />}
        <span className="lp-play" aria-hidden><svg viewBox="0 0 24 24"><path d="M8 5v14l11-7z" /></svg></span>
        {p.seconds !== undefined && <span className="lp-time">{duration(p.seconds)}</span>}
      </span>
      <span className="lp-info">
        <span className="lp-title">{p.title}</span>
        {p.channel && <span className="lp-channel"><PlatformIcon platform={p.platform} size={14} /> {p.channel}</span>}
        <span className="lp-facts">{facts}</span>
      </span>
    </a>
  )
}

/**
 * The card under a message with a video or clip link. While the details load, an empty card of
 * the same size holds the space, so chat doesn't jump; a link with no details shows nothing.
 */
export function LinkPreviewFor({ url }: { url: string }): JSX.Element | null {
  const [p, setP] = useState<LinkPreview | null | undefined>(() => cached(url))
  useEffect(() => {
    const hit = cached(url)
    if (hit !== undefined) return setP(hit)
    setP(undefined)
    let alive = true
    void window.nnf.linkPreview(url).catch(() => null).then((r) => {
      known.set(url, { p: r, at: Date.now() })
      if (known.size > 600) known.delete(known.keys().next().value!)
      if (alive) setP(r)
    })
    return () => { alive = false }
  }, [url])
  if (p === null) return null
  if (p === undefined) return <span className="lp lp-loading" aria-hidden><span className="lp-thumb" /><span className="lp-info"><span className="lp-bar" /><span className="lp-bar short" /></span></span>
  return <PreviewCard p={p} />
}
