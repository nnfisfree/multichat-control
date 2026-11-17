import { useEffect, useRef, useState, type JSX, type ReactNode } from 'react'
import fourthwall from '../../assets/fourthwall.png'
import logo from '../../assets/logo.webp'
import { PlatformIcon } from './Icons'
import { BMC_URL, SupportPill } from './SupportPill'
import { BUNDLED_SUPPORTERS, SUPPORTERS_URL, cleanSupporters, type Supporter } from '../../shared/supporters'
import { ANONYMOUS } from '../../shared/moderation'
import { useStore } from '../lib/store'

const DONATE_URL = 'https://streamelements.com/nonamefound/tip'
const SUBSCRIBE_URL = 'https://www.twitch.tv/subs/nonamefound'
const STORE_URL = 'https://nonamefound.lol/en-eur'

const open = (url: string) => (): void => void window.nnf.openExternal(url)

function PayPalMark(): JSX.Element {
  return (
    <svg viewBox="0 0 24 24" width="18" height="18" aria-hidden="true">
      <path fill="#fff" d="M8.3 21.2H4.9a.6.6 0 0 1-.6-.7L7 3.4A.8.8 0 0 1 7.8 2.7h6.1c3.4 0 5.5 1.7 4.9 5-.6 3.8-3.2 5.6-6.6 5.6H10a.8.8 0 0 0-.8.7l-.9 7.2z" />
      <path fill="#cfe6ff" d="M19.6 7.9c-.7 3.9-3.4 5.8-7 5.8h-1.6a.8.8 0 0 0-.8.7l-1 6.5a.5.5 0 0 0 .5.6h2.8a.7.7 0 0 0 .7-.6l.6-3.6a.8.8 0 0 1 .8-.7h.9c3 0 5.2-1.6 5.8-4.8.3-1.6 0-2.9-.7-3.9z" />
    </svg>
  )
}

function SupportButtons(): JSX.Element {
  return (
    <div className="support-buttons">
      <button className="support-btn paypal" onClick={open(DONATE_URL)}><PayPalMark /> Donate</button>
      <button className="support-btn twitch-sub" onClick={open(SUBSCRIBE_URL)}><PlatformIcon platform="twitch" size={18} /> Subscribe on Twitch</button>
      <button className="support-btn store" onClick={open(STORE_URL)}><img src={fourthwall} alt="" width={18} height={18} /> Gadgets Store</button>
    </div>
  )
}

const money = (s: Supporter): string =>
  new Intl.NumberFormat(undefined, { style: 'currency', currency: s.currency, minimumFractionDigits: s.amount % 1 ? 2 : 0, maximumFractionDigits: 2 }).format(s.amount)

// a stable pair of colours per name, for supporters without a picture
const hue = (name: string): number => [...name].reduce((h, c) => (h * 31 + c.charCodeAt(0)) >>> 0, 7) % 360

function SupporterAvatar({ s }: { s: Supporter }): JSX.Element {
  const [broken, setBroken] = useState(false)
  const h = hue(s.name)
  const initials = s.name.replace(/[^\p{L}\p{N} ]/gu, '').split(/\s+/).map((w) => w[0]).join('').slice(0, 2).toUpperCase() || '?'
  return (
    <span className="sup-avatar">
      {s.avatar && !broken
        ? <img src={s.avatar} alt="" width={64} height={64} loading="lazy" referrerPolicy="no-referrer" onError={() => setBroken(true)} />
        : <span className="sup-initials" style={{ background: `linear-gradient(135deg, hsl(${h} 70% 45%), hsl(${(h + 50) % 360} 75% 35%))` }}>{s.name === ANONYMOUS ? '🤍' : initials}</span>}
    </span>
  )
}

const CACHE_KEY = 'nnf.supporters'
// The wall shows the cached (or built-in) list right away, then whatever GitHub has. Checked again
// when the page is opened and the last check is older than this.
const RECHECK_MS = 5 * 60 * 1000
let latest: Supporter[] | null = null
let loading: Promise<Supporter[] | null> | null = null
let checkedAt = 0

function cached(): Supporter[] | null {
  try {
    return cleanSupporters(JSON.parse(localStorage.getItem(CACHE_KEY) ?? 'null'))
  } catch {
    return null
  }
}

function fetchSupporters(): Promise<Supporter[] | null> {
  if (loading && Date.now() - checkedAt > RECHECK_MS - 5000) loading = null
  if (!loading) checkedAt = Date.now()
  loading ??= (async () => {
    try {
      const ctl = new AbortController()
      const t = setTimeout(() => ctl.abort(), 8000)
      const res = await fetch(SUPPORTERS_URL, { cache: 'no-cache', signal: ctl.signal })
      clearTimeout(t)
      const list = res.ok ? cleanSupporters(await res.json()) : null
      if (list) {
        latest = list
        try { localStorage.setItem(CACHE_KEY, JSON.stringify(list)) } catch { /* private mode etc. */ }
      }
      return list
    } catch {
      // offline or GitHub unreachable: keep what we have, try again next time the page opens
      loading = null
      return null
    }
  })()
  return loading
}

// Demo mode doesn't fetch from GitHub; it shows the list built into the app.
const demoSupporters = (): Supporter[] => BUNDLED_SUPPORTERS

/** The supporters list from GitHub, falling back to the last one seen, then the built-in one. */
function useSupporters(): Supporter[] {
  const demo = useStore((s) => !!s.boot?.demo)
  const [list, setList] = useState<Supporter[]>(() => (demo ? demoSupporters() : latest ?? cached() ?? BUNDLED_SUPPORTERS))
  useEffect(() => {
    if (demo) return
    let alive = true
    const check = (): void => void fetchSupporters().then((l) => { if (alive && l) setList(l) })
    check()
    // keeps checking while the page stays open, so a new supporter pops in without reopening it
    const timer = setInterval(check, RECHECK_MS)
    return () => { alive = false; clearInterval(timer) }
  }, [demo])
  return list
}

/** Everyone who chipped in, biggest first, then an open seat for whoever's next. */
function SupporterWall(): JSX.Element {
  const list = [...useSupporters()].sort((a, b) => b.amount - a.amount)
  return (
    <section className="sup-wall" aria-label="Supporters">
      <header className="sup-head">
        <h3>💜 Wall of Supporters</h3>
        <span className="sup-count">{list.length} {list.length === 1 ? 'hero' : 'heroes'}</span>
      </header>
      <div className="sup-grid">
        {list.map((s, i) => (
          <button key={`${s.name}-${i}`} className={i === 0 ? 'sup-card top' : 'sup-card'} title={s.url ? `Open ${s.name}'s profile` : s.name} disabled={!s.url} onClick={s.url ? open(s.url) : undefined}>
            {i === 0 && <span className="sup-crown" aria-label="Top supporter">👑</span>}
            <SupporterAvatar s={s} />
            <b className="sup-name">{s.name}</b>
            {s.title && <span className="sup-title" title={s.title}>{s.title}</span>}
            <span className="sup-amount">{money(s)}</span>
            {s.message && <span className="sup-msg" title={s.message}>“{s.message}”</span>}
          </button>
        ))}
        <button className="sup-card next" onClick={open(BMC_URL)} title="Support the project on Buy Me a Coffee">
          <span className="sup-avatar empty" aria-hidden="true">?</span>
          <b className="sup-name">Wanna be next?</b>
          <span className="sup-cta">Your face could be here ☕</span>
        </button>
      </div>
    </section>
  )
}

const FEATURES: [string, string, string][] = [
  ['🆓', '100% Free', 'No subscriptions, hidden fees, or paywalls.'],
  ['💻', 'Open Source', 'Anyone can explore the code, contribute, improve it, or learn from it.'],
  ['🔒', 'Privacy First', 'No tracking, no harvesting, no collecting your personal data. Period.'],
  ['🎮', 'Made by a Streamer, for Streamers', 'Built from real streaming needs, not corporate decisions.']
]

// Author's own words, keep them exactly as written.
const CHAPTERS: { id: string; label: ReactNode; body: () => JSX.Element }[] = [
  {
    id: 'story',
    label: 'My Story',
    body: () => (
      <>
        <header className="about-hero">
          <img src={logo} alt="NoNameFound logo" />
          <div>
            <h3>👋 Who Am I?</h3>
            <p>Hey there! I'm <b>NoNameFound</b>, just a streamer like you, a humble <b>IT Engineering graduate</b>, a passionate <b>Linux enthusiast</b>, and someone who loves <b>coding, streaming, and gaming</b>.</p>
            <p>I'm not a big company or a team of developers. I'm just one guy who enjoys building things, solving problems, and sharing what he creates with others.</p>
          </div>
        </header>
        <h3>💡 Why I Created ChatControl</h3>
        <p>The idea behind <b>ChatControl</b> came from a simple frustration: I tried different tools and applications to manage my streaming experience, but none of them perfectly fit my needs.</p>
        <p>There was always something missing, something I wished worked differently, or a feature I really wanted.</p>
        <p>So, one day, I thought: <b>"Why not just build my own?"</b></p>
        <p>And that's how ChatControl was born.</p>
        <p>What started as a personal project became something I wanted to share with the entire streaming community. Because if I needed a tool like this, chances are someone else does too!</p>
      </>
    )
  },
  {
    id: 'free',
    label: 'Free & Open',
    body: () => (
      <>
        <h3>❤️ Free, Open Source, and Privacy First</h3>
        <p>I strongly believe that useful software should be accessible to everyone.</p>
        <p>That's why <b>ChatControl is completely FREE and OPEN SOURCE</b>, and it always will be.</p>
        <div className="about-cards">
          {FEATURES.map(([icon, title, text]) => (
            <div key={title} className="about-card"><span className="about-card-icon">{icon}</span><b>{title}</b><span>{text}</span></div>
          ))}
        </div>
        <p><b>Your data belongs to you, not to me.</b> I have absolutely no interest in collecting, monitoring, or selling anyone's information.</p>
        <p>Just a useful tool, built with passion, shared with everyone.</p>
      </>
    )
  },
  {
    id: 'support',
    label: 'Support',
    body: () => (
      <>
        <h3>☕ Support ChatControl</h3>
        <SupporterWall />
        <div className="support-letter">
        <p>ChatControl is a passion project, developed and maintained independently in my spare time.</p>
        <p>Behind every feature, bug fix, and improvement are countless hours of coding, testing, debugging, and probably way too much coffee! ☕</p>
        <p>If ChatControl makes your streaming life a little easier, and you'd like to support its development, <b>please consider making a small donation</b>.</p>
        <p>Even the price of a coffee can make a difference!</p>
        <p>Your support helps me dedicate more time to improving the app, creating new features, fixing bugs, and keeping the project <b>free and open source for everyone</b>.</p>
        <p>Donations are completely optional. You'll always have access to the same features whether you donate or not.</p>
        <p>And if you can't donate, that's perfectly fine! Sharing ChatControl with your friends, reporting bugs, suggesting features, or contributing to the code is just as appreciated.</p>
        <p><b>Every little bit of support means the world to me. ❤️</b></p>
        <p>Thank you for being part of this journey!</p>
        <p className="about-sign">— <b>NoNameFound</b> 🎮🐧</p>
        </div>
        <SupportPill big />
        <SupportButtons />
      </>
    )
  },
  {
    id: 'memory',
    label: <>🕊️ In Memory</>,
    body: () => (
      <section className="memorial" aria-label="In Loving Memory">
        <div className="memorial-dove" aria-hidden="true">🕊️</div>
        <h3>In Loving Memory</h3>
        <p className="memorial-dedication"><b>This project is lovingly dedicated to my beloved Dad, Francesco, and my beloved Mum, Adriana.</b></p>
        <div className="memorial-line" aria-hidden="true" />
        <p>Everything I create carries a little piece of you both.</p>
        <p>Your love, your memories, and everything you taught me will forever remain part of who I am and everything I do.</p>
        <p><b>Forever loved, never forgotten, and always in my heart. ❤️</b></p>
        <p className="memorial-always"><i>For you, Dad Francesco and Mum Adriana. Always.</i> ❤️🕊️❤️</p>
        <p className="memorial-signature">Your son, Omar ❤️</p>
      </section>
    )
  }
]

/** Split into chapters so the dedication gets a page of its own. */
export function About({ chapter: start }: { chapter?: string } = {}): JSX.Element {
  const [chapter, setChapter] = useState(CHAPTERS.some((c) => c.id === start) ? start! : CHAPTERS[0].id)
  const page = useRef<HTMLDivElement>(null)
  const current = CHAPTERS.find((c) => c.id === chapter) ?? CHAPTERS[0]
  const pick = (id: string): void => {
    setChapter(id)
    page.current?.scrollTo({ top: 0 })
  }
  return (
    <div className="about-page">
      <nav className="about-chapters" role="tablist" aria-label="About chapters">
        {CHAPTERS.map((c) => (
          <button key={c.id} role="tab" aria-selected={c.id === chapter} className={c.id === chapter ? 'on' : ''} onClick={() => pick(c.id)}>{c.label}</button>
        ))}
      </nav>
      <div className={current.id === 'memory' ? 'about-body memory' : 'about-body'} ref={page} role="tabpanel">
        <div className="about-inner"><current.body /></div>
      </div>
    </div>
  )
}
