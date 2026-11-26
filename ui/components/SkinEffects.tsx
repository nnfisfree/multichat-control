import { useEffect, useState, type CSSProperties, type JSX } from 'react'
import { useStore } from '../lib/store'
import { skinById } from '../styles/skins'

/*
 * Decorations for skins that have them (Frosty Christmas): falling snow behind the chat, a string of
 * twinkling lights along the top of the window, and a Santa hat on the app icon. The snow caps on the
 * message box and the sparkle on sub/gift pop-ups are plain CSS in theme.css, switched on by
 * the data-fx attributes set here. Everything is CSS animation, so it costs next to nothing, and it
 * never takes a click: the layers ignore the mouse.
 *
 * data-fx-anim: 'on' moves, 'paused' freezes in place (window minimized),
 * 'off' = still version (Animate skin switched off, or the PC asks for reduced motion).
 */

// a fixed random layout, so the snow looks the same every time and never jumps on a re-render
const FLAKES = (() => {
  let seed = 7
  const rnd = (): number => (seed = (seed * 9301 + 49297) % 233280) / 233280
  return Array.from({ length: 36 }, () => {
    const size = 12 + rnd() * 10
    return {
      left: `${(rnd() * 100).toFixed(2)}%`,
      width: `${size.toFixed(1)}px`,
      height: `${size.toFixed(1)}px`,
      opacity: +(0.55 + rnd() * 0.45).toFixed(2),
      '--dx': `${Math.round((rnd() - 0.5) * 80)}px`,
      // smaller flakes fall slower, like they're further away
      // as variables: theme.css runs two animations per flake (the fall and an icy shimmer)
      '--dur': `${(10 + rnd() * 9 + (22 - size) * 0.5).toFixed(1)}s`,
      '--delay': `-${(rnd() * 20).toFixed(1)}s`
    } as CSSProperties
  })
})()

// classic C9 colours: red, gold, green, blue, orange
const BULB_COLORS = ['#ff3b3b', '#ffcc33', '#2ee06f', '#3fa8ff', '#ff8a1f']
const BULBS = Array.from({ length: 34 }, (_, i) => ({
  '--bc': BULB_COLORS[i % BULB_COLORS.length],
  // the glow runs along the string like a wave; each bulb also sways a little on the wire
  '--chase': `${(i * 0.14).toFixed(2)}s`,
  '--sway': `${(2.6 + (i % 5) * 0.35).toFixed(2)}s`,
  '--sway-delay': `-${((i * 0.53) % 3).toFixed(2)}s`
}) as CSSProperties)
// the wire dips once per bulb; stretched to the window width
const WIRE = (() => {
  const w = 1000 / BULBS.length
  let d = 'M0 2'
  for (let k = 0; k < BULBS.length; k++) d += ` Q ${(k * w + w / 2).toFixed(1)} 12 ${((k + 1) * w).toFixed(1)} 2`
  return d
})()

/*
 * Frost in a window corner: fern-like ice branches growing out of the corner, drawn once for the
 * top-left corner and mirrored by CSS for the others. Fixed random layout, like the snow.
 */
const FROST = (() => {
  let seed = 11
  const rnd = (): number => (seed = (seed * 9301 + 49297) % 233280) / 233280
  const parts: string[] = []
  // one branch: a line from (x, y) at angle a, with little side twigs that get shorter towards the tip
  const branch = (x: number, y: number, a: number, len: number, depth: number): void => {
    const steps = 5
    let px = x
    let py = y
    for (let i = 1; i <= steps; i++) {
      const bend = a + (rnd() - 0.5) * 0.25
      const nx = px + Math.cos(bend) * (len / steps)
      const ny = py + Math.sin(bend) * (len / steps)
      parts.push(`M${px.toFixed(1)} ${py.toFixed(1)}L${nx.toFixed(1)} ${ny.toFixed(1)}`)
      if (depth > 0 && i < steps) {
        const twig = (len / steps) * (1.6 - i * 0.22)
        for (const side of [-1, 1]) {
          const ta = bend + side * (0.75 + rnd() * 0.3)
          if (depth > 1 && i <= 2) branch(nx, ny, ta, twig * 1.4, depth - 1)
          else parts.push(`M${nx.toFixed(1)} ${ny.toFixed(1)}l${(Math.cos(ta) * twig).toFixed(1)} ${(Math.sin(ta) * twig).toFixed(1)}`)
        }
      }
      px = nx
      py = ny
    }
  }
  for (let k = 0; k < 8; k++) branch(0, 0, (k / 7) * (Math.PI / 2) * 0.92 + 0.06, 90 + rnd() * 70, 2)
  return parts.join('')
})()

function FrostCorner({ at }: { at: 'tl' | 'tr' | 'bl' | 'br' }): JSX.Element {
  return (
    <svg className={`fx-frost ${at}`} viewBox="0 0 170 170" aria-hidden="true">
      <path d={FROST} />
    </svg>
  )
}

/** Santa, his sleigh and two reindeer, facing right. */
function Sleigh(): JSX.Element {
  return (
    <svg className="fx-sleigh-art" viewBox="0 0 132 40">
      {/* reins */}
      <path d="M58 22 C70 18 80 18 92 17 M58 24 C72 22 84 21 100 20" fill="none" stroke="#7a4a1d" strokeWidth="0.9" />
      {/* two reindeer, the front one with a red nose */}
      {[{ x: 84, nose: '#5b3a1c' }, { x: 104, nose: '#ff2d2d' }].map(({ x, nose }) => (
        <g key={x} transform={`translate(${x} 0)`}>
          <path d="M4 22 C4 16 10 14 17 15 C20 15 22 13 23 11 L26 12 C25 16 23 19 19 21 C14 24 8 25 4 22 Z" fill="#8b5a2b" />
          <path d="M6 22 L4 30 M10 23 L9 31 M16 22 L18 30 M19 21 L22 29" stroke="#6b4320" strokeWidth="1.6" strokeLinecap="round" />
          <path d="M23 11 L22 5 M22 7 L19 5 M24 11 L27 5 M26 7 L29 6" stroke="#6b4320" strokeWidth="1.1" strokeLinecap="round" fill="none" />
          <circle cx="27" cy="13" r="1.4" fill={nose} />
        </g>
      ))}
      {/* the sleigh, Santa and his sack */}
      <path d="M30 14 C31 9 36 8 39 11 L38 18 Z" fill="#7a3fc4" />
      <circle cx="46" cy="12" r="5" fill="#c8102e" />
      <circle cx="46" cy="7" r="3.2" fill="#f2c9a8" />
      <path d="M43 5 C44 1 50 1 51 5 Z" fill="#c8102e" />
      <circle cx="51.5" cy="3.5" r="1.3" fill="#ffffff" />
      <path d="M43.5 9.5 C44.5 12 47.5 12 48.5 9.5 Z" fill="#ffffff" />
      <path d="M26 16 L60 16 C62 16 62 26 56 27 L32 27 C27 27 25 22 26 16 Z" fill="#c8102e" />
      <path d="M27 18 L59 18" stroke="#e0a91b" strokeWidth="1.3" />
      <path d="M24 31 L58 31 C63 31 64 27 61 26 M30 27 L29 31 M52 27 L53 31" fill="none" stroke="#e0a91b" strokeWidth="1.6" strokeLinecap="round" />
    </svg>
  )
}

// first fly-by a little after the skin is picked, then every 4 to 7 minutes
const SLEIGH_FIRST_MS = 45_000
const SLEIGH_GAP_MS = (): number => (4 + Math.random() * 3) * 60_000
const SLEIGH_FLIGHT_MS = 6500

/**
 * True unless the window is minimized (hidden). Not tied to focus: streamers capture the window in
 * OBS while they play, and the snow should keep falling on stream.
 */
function useAwake(): boolean {
  const check = (): boolean => document.visibilityState === 'visible'
  const [awake, setAwake] = useState(check)
  useEffect(() => {
    const update = (): void => setAwake(check())
    document.addEventListener('visibilitychange', update)
    return () => document.removeEventListener('visibilitychange', update)
  }, [])
  return awake
}

function useReducedMotion(): boolean {
  const query = typeof window !== 'undefined' ? window.matchMedia?.('(prefers-reduced-motion: reduce)') : undefined
  const [reduced, setReduced] = useState(!!query?.matches)
  useEffect(() => {
    if (!query) return
    const update = (): void => setReduced(query.matches)
    query.addEventListener('change', update)
    return () => query.removeEventListener('change', update)
  }, [query])
  return reduced
}

export function SkinEffects(): JSX.Element | null {
  const theme = useStore((s) => s.settings?.theme)
  const animate = useStore((s) => s.settings?.skinEffects ?? true)
  const fx = skinById(theme).effects
  const awake = useAwake()
  const reduced = useReducedMotion()
  const moving = !!fx && animate && !reduced
  const state = !moving ? 'off' : awake ? 'on' : 'paused'

  // Santa's sleigh: only while the effects move and the window is up. Each flight gets a new key so
  // its animation starts over. 'nnf:fx-sleigh' sends one right away (handy for trying it out).
  const [flight, setFlight] = useState(0)
  useEffect(() => {
    if (fx !== 'xmas' || state !== 'on') return
    let t = setTimeout(function fly() {
      setFlight((n) => n + 1)
      t = setTimeout(fly, SLEIGH_GAP_MS())
    }, SLEIGH_FIRST_MS)
    const now = (): void => setFlight((n) => n + 1)
    window.addEventListener('nnf:fx-sleigh', now)
    return () => {
      clearTimeout(t)
      window.removeEventListener('nnf:fx-sleigh', now)
    }
  }, [fx, state])
  const [flying, setFlying] = useState(false)
  useEffect(() => {
    if (!flight) return
    setFlying(true)
    const t = setTimeout(() => setFlying(false), SLEIGH_FLIGHT_MS)
    return () => clearTimeout(t)
  }, [flight])

  useEffect(() => {
    const root = document.documentElement
    if (fx) {
      root.dataset.fx = fx
      root.dataset.fxAnim = state
    } else {
      delete root.dataset.fx
      delete root.dataset.fxAnim
    }
  }, [fx, state])

  if (fx !== 'xmas') return null
  return (
    <>
      {/* frost on the four corners of the window, behind everything like the snow */}
      <div className="fx-frosts" aria-hidden="true">{(['tl', 'tr', 'bl', 'br'] as const).map((at) => <FrostCorner key={at} at={at} />)}</div>
      {moving && <div className="fx-snow" aria-hidden="true">{FLAKES.map((style, i) => <i key={i} style={style} />)}</div>}
      {/* the sky behind the title bar: the sleigh crosses it behind the lights, the app name and the
          channel stats, leaving a trail of sparkles */}
      {flying && state === 'on' && (
        <div className="fx-sky" aria-hidden="true">
          <div key={flight} className="fx-sleigh">
            <span className="fx-trail">{Array.from({ length: 9 }, (_, i) => <i key={i} style={{ '--i': i } as CSSProperties} />)}</span>
            <Sleigh />
          </div>
        </div>
      )}
      <div className="fx-top" aria-hidden="true">
        <svg className="fx-wire" viewBox="0 0 1000 12" preserveAspectRatio="none"><path d={WIRE} /></svg>
        <div className="fx-bulbs">{BULBS.map((style, i) => <span key={i} className="fx-bulb" style={style}><b /><i /></span>)}</div>
        {/* worn on the app icon: the brim sits over its top edge, the tip flops over and the pom-pom bounces */}
        <svg className="fx-hat" viewBox="0 0 32 28">
          <g className="fx-hat-tip">
            <path d="M4 19 C5 10 11 3 19 3 C24 3 27 6 29 10 C25 8 22 9 21 12 C20 15 22 18 24 19 Z" fill="#c8102e" />
            <path d="M8 18 C9 12 13 7 18 6 C14 9 12 13 12 18 Z" fill="#ffffff" opacity="0.18" />
            <circle className="fx-pom" cx="29" cy="11" r="3.4" fill="#ffffff" stroke="#c9d8e4" strokeWidth="0.8" />
          </g>
          <rect x="1" y="17" width="25" height="7" rx="3.5" fill="#ffffff" stroke="#c9d8e4" strokeWidth="0.8" />
        </svg>
      </div>
    </>
  )
}

/** A burst of red and gold stars for a sub or gift pop-up. Hidden by CSS unless the skin's effects are moving. */
export function Sparkle(): JSX.Element {
  return (
    <span className="fx-sparkle" aria-hidden="true">
      {Array.from({ length: 12 }, (_, s) => {
        const a = (s / 12) * Math.PI * 2
        const r = 26 + (s % 3) * 10
        return <i key={s} style={{ '--sx': `${Math.round(Math.cos(a) * r)}px`, '--sy': `${Math.round(Math.sin(a) * r)}px`, '--sd': `${(s % 3) * 0.06}s`, '--sc': s % 2 ? '#f4c95d' : '#c8102e' } as CSSProperties} />
      })}
    </span>
  )
}
