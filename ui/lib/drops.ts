/**
 * Things raining down over chat: Twitch Bits, gift boxes, and banknotes for tips. Ported from the
 * "Bits Cloud" and "Gift Cloud" OBS overlays without their cloud bank: the pieces start just above
 * the top of the host element and fall through it with their trails, halos, glints and the sparkle
 * dust. The banknotes are the same animation with paper money that flutters and flips as it falls.
 *
 * The overlays drew on a fixed 2560 × 1440 stage. Here the SVG takes the host's real size in pixels,
 * and the number of pieces, their speed and drift follow it, so a narrow chat gets a lighter shower
 * of the same-sized pieces instead of a shrunken copy of the full-screen one.
 */

export type DropKind = 'bits' | 'gifts' | 'money'

export interface DropOptions {
  /** 0..1, how many pieces fall (a small cheer vs a huge one). */
  strength: number
  /** How long new pieces keep coming, in seconds. The last ones still need a moment to fall out. */
  seconds: number
  /** Printed on the banknotes: "$", "€", "£"… */
  symbol?: string
}

const NS = 'http://www.w3.org/2000/svg'
// the overlays rained for this long; piece counts are per this much rain
const BASE_RAIN = 8.5
// the overlays fell through 1440 px; slower on a short chat, but not so slow it drags
const MIN_FALL_SCALE = 0.45

const rand = (a: number, b: number): number => a + (b - a) * Math.random()
const clamp = (x: number): number => Math.max(0, Math.min(1, x))
const ease = (x: number): number => 1 - Math.pow(1 - clamp(x), 3)
const smooth = (x: number): number => { x = clamp(x); return x * x * (3 - 2 * x) }
const escapeXml = (t: string): string => t.replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' })[c]!)

function el(tag: string, attrs: Record<string, string | number>, parent?: Element): SVGElement {
  const n = document.createElementNS(NS, tag)
  for (const [k, v] of Object.entries(attrs)) n.setAttribute(k, String(v))
  if (parent) parent.appendChild(n)
  return n
}

// Ids are prefixed; only one drop runs at a time.
const STAR_DEF = '<path id="nnfdrop-star" d="M0-12 2.6-2.6 12 0 2.6 2.6 0 12-2.6 2.6-12 0-2.6-2.6Z" fill="#fff1ff"/>'
const glow = (trail: [string, string], halo: [string, string]): string => `
 <linearGradient id="nnfdrop-trail" x2="0" y2="1"><stop stop-color="${trail[0]}" stop-opacity="0"/><stop offset="1" stop-color="${trail[1]}" stop-opacity=".65"/></linearGradient>
 <radialGradient id="nnfdrop-halo"><stop stop-color="${halo[0]}" stop-opacity=".45"/><stop offset="1" stop-color="${halo[1]}" stop-opacity="0"/></radialGradient>`
const PURPLE_GLOW = glow(['#b985ff', '#e5caff'], ['#d2a4ff', '#b879ff'])
const GREEN_GLOW = glow(['#7ee0a0', '#d9ffe6'], ['#9dffbe', '#4fd17e'])

const BIT_DEF = `
 <g id="nnfdrop-piece">
  <path d="M0-46 32 6 0 45-32 6Z" fill="#9146ff" stroke="#dab4ff" stroke-width="1.3" stroke-linejoin="round"/>
  <path d="M0-46 0 6-32 6Z" fill="#d9b7ff"/><path d="M0-46 32 6 0 6Z" fill="#a76aff"/>
  <path d="M-32 6 0 45 0 6Z" fill="#8838df"/><path d="M0 6 32 6 0 45Z" fill="#5c20b7"/>
  <path d="M0-46-14 6H0Z" fill="#f5e8ff" opacity=".6"/><path d="M-30 6H30M0-44V43" fill="none" stroke="#f5ddff" stroke-opacity=".5"/>
 </g>`

// satin bow, dimensional lid, ribbon and a front-facing Twitch mark
const GIFT_DEF = `
 <g id="nnfdrop-piece">
  <path d="M0-52C-51-91-62-48-10-46C-43-54-38-73 0-52Z" fill="#fff0ce" stroke="#e6b5ed" stroke-width="2"/>
  <path d="M0-52C51-91 62-48 10-46C43-54 38-73 0-52Z" fill="#ffd9f1" stroke="#e6b5ed" stroke-width="2"/>
  <path d="M-50-31H47V54H-50Z" fill="#9146ff" stroke="#e5baff" stroke-width="2"/>
  <path d="M47-31 62-42V41L47 54Z" fill="#5926ae" stroke="#c18af5" stroke-width="2"/>
  <path d="M-50-31-35-43H62L47-31Z" fill="#c79aff"/>
  <path d="M-10-31H8V54H-10Z" fill="#ffd6ed"/>
  <path d="M-50 16H47V30H-50Z" fill="#eeb9ed"/>
  <path d="M47 16 62 5V19L47 30Z" fill="#d18aca"/>
  <path d="M-56-48H50V-26H-56Z" fill="#b275ff" stroke="#f0d3ff" stroke-width="2"/>
  <path d="M50-48 66-59V-37L50-26Z" fill="#7634cc" stroke="#c18af5" stroke-width="2"/>
  <path d="M-56-48-40-59H66L50-48Z" fill="#dbbaff" stroke="#f0d3ff" stroke-width="2"/>
  <path d="M-11-48H9V-26H-11Z" fill="#fff0d9"/>
  <path d="M-11-48 5-59H25L9-48Z" fill="#fff8ec"/>
  <ellipse cx="0" cy="-53" rx="12" ry="9" fill="#fff0dc" stroke="#e6b5ed" stroke-width="2"/>
  <path d="M-44-16V5M-44 38V47" fill="none" stroke="#d3a2ff" stroke-width="3" stroke-linecap="round"/>
  <rect x="-28" y="-17" width="52" height="57" rx="11" fill="#6420bb" stroke="#e2b5ff" stroke-width="2"/>
  <g transform="translate(-21 -10) scale(1.9)">
   <path d="M4 0 0 4V20H6V24L10 20H14L20 14V0Z" fill="white"/>
   <path d="M5 2H18V13L14 17H10L7 20V17H3V4Z" fill="#9146ff"/>
   <path d="M8 5H10V11H8ZM13 5H15V11H13Z" fill="white"/>
  </g>
 </g>`

/** A green banknote: guilloche border, portrait medallion with the currency sign, corner marks. */
function moneyDef(symbol: string): string {
  const sign = escapeXml(symbol)
  // a longer code ("CHF") gets a smaller font so it still fits the medallion
  const big = symbol.length > 1 ? 34 / symbol.length + 6 : 34
  const small = symbol.length > 1 ? 12 / symbol.length + 3 : 13
  const corner = (x: number, y: number): string => `<text x="${x}" y="${y}" font-size="${small}" font-weight="800" text-anchor="middle" dominant-baseline="central" fill="#e9ffe9" font-family="Segoe UI, Arial, sans-serif">${sign}</text>`
  return `
 <g id="nnfdrop-piece">
  <rect x="-72" y="-36" width="144" height="72" rx="5" fill="#3e9b57" stroke="#d6f7dc" stroke-width="2"/>
  <rect x="-64" y="-28" width="128" height="56" rx="3" fill="#57b56f" stroke="#2c7442" stroke-width="2"/>
  <path d="M-64-14C-54-22-44-6-34-14S-14-6-4-14 16-6 26-14 46-6 64-14M-64 14C-54 6-44 22-34 14S-14 22-4 14 16 22 26 14 46 22 64 14" fill="none" stroke="#9fe3b0" stroke-width="1.6" opacity=".55"/>
  <ellipse cx="0" cy="0" rx="25" ry="22" fill="#2f8048" stroke="#e3ffe8" stroke-width="2.4"/>
  <ellipse cx="0" cy="0" rx="19" ry="16.5" fill="none" stroke="#9fe3b0" stroke-width="1.2" stroke-dasharray="2 2.4"/>
  <text x="0" y="1.5" font-size="${big}" font-weight="900" text-anchor="middle" dominant-baseline="central" fill="#f2fff4" font-family="Segoe UI, Arial, sans-serif">${sign}</text>
  ${corner(-52, -18)}${corner(52, -18)}${corner(-52, 18)}${corner(52, 18)}
  <path d="M-72-36H-20L-60 36H-72Z" fill="#ffffff" opacity=".13"/>
 </g>`
}

/** What differs between the kinds. */
interface KindInfo {
  def: (symbol: string) => string
  glow: string
  /** Pieces over BASE_RAIN seconds on a 1400 px wide chat at full strength. */
  count: number
  halo: number
  glint: string
  scale: number
  size: readonly [number, number]
  bigEvery: number
  big: number
  rotate: number
  turn: number
  /** 1 = the overlays' fall speed. Paper floats down slower. */
  speed: number
  /** Side-to-side sway, px. */
  sway: number
  spin(p: Piece, age: number): string
}

const KIND: Record<DropKind, KindInfo> = {
  bits: {
    def: () => BIT_DEF, glow: PURPLE_GLOW, count: 288, halo: 67, glint: 'translate(-12 -13) scale(.45)', scale: 0.42,
    size: [0.32, 0.95], bigEvery: 11, big: 1.35, rotate: 65, turn: 120, speed: 1, sway: 28,
    spin: (p, age) => `rotate(${(p.rotate + p.turn * age).toFixed(1)}) scale(${(0.72 + 0.28 * Math.cos(age * 4 + p.phase)).toFixed(3)} 1)`
  },
  gifts: {
    def: () => GIFT_DEF, glow: PURPLE_GLOW, count: 156, halo: 86, glint: 'translate(-43 -43) scale(.65)', scale: 0.3,
    size: [0.85, 1.18], bigEvery: 9, big: 1.16, rotate: 16, turn: 14, speed: 1, sway: 28,
    spin: (p, age) => `rotate(${(p.rotate + Math.sin(age * 2.7 + p.phase) * 13 + p.turn * age * 0.3).toFixed(1)}) scale(${(0.94 + 0.06 * Math.cos(age * 3 + p.phase)).toFixed(3)} 1)`
  },
  money: {
    def: moneyDef, glow: GREEN_GLOW, count: 150, halo: 82, glint: 'translate(-50 -24) scale(.6)', scale: 0.3,
    size: [0.85, 1.2], bigEvery: 9, big: 1.18, rotate: 40, turn: 40, speed: 0.72, sway: 46,
    // see-saws side to side and flips over like paper; never fully edge-on so it doesn't vanish
    spin: (p, age) => {
      const flip = Math.cos(age * 3.1 + p.phase)
      return `rotate(${(p.rotate + Math.sin(age * 2.2 + p.phase) * 28 + p.turn * age * 0.4).toFixed(1)}) scale(1 ${(Math.sign(flip || 1) * Math.max(0.18, Math.abs(flip))).toFixed(3)})`
    }
  }
}

interface Piece {
  g: SVGElement; spin: SVGElement; trail: SVGElement; glint: SVGElement
  born: number; x: number; size: number; speed: number; drift: number; phase: number; rotate: number; turn: number
  shown: boolean
}
interface Sparkle { n: SVGElement; x: number; y: number; born: number; life: number; size: number; angle: number; shown: boolean }

/**
 * Starts a drop inside `host` (which should be position: absolute/fixed and sized). Calls `onEnd`
 * once the last piece has left; the returned function stops it early. Either way the SVG is removed.
 */
export function playDrop(host: HTMLElement, kind: DropKind, opts: DropOptions, onEnd: () => void): () => void {
  const k = KIND[kind]
  const rainFor = Math.max(1, opts.seconds)
  const w = Math.max(1, host.clientWidth)
  const h = Math.max(1, host.clientHeight)
  const fall = Math.max(MIN_FALL_SCALE, h / 1440) * k.speed
  const across = Math.min(1, w / 1280)

  const svg = el('svg', { viewBox: `0 0 ${w} ${h}`, preserveAspectRatio: 'xMidYMin slice', 'aria-hidden': 'true' }) as SVGSVGElement
  svg.innerHTML = `<defs>${k.glow}${STAR_DEF}${k.def(opts.symbol || '$')}</defs>`
  const rain = el('g', {}, svg)
  const dust = el('g', {}, svg)

  // the full overlay's count at 1400 px and up, fewer on a narrower chat or for a small event, and
  // as many per second whatever the length, so a longer drop isn't a thinner one
  const n = Math.max(24, Math.round(k.count * Math.max(0.3, Math.min(1, w / 1400)) * (0.4 + 0.6 * clamp(opts.strength)) * (rainFor / BASE_RAIN)))
  const pieces: Piece[] = []
  for (let i = 0; i < n; i++) {
    const g = el('g', { opacity: 0 }, rain)
    const trail = el('path', { d: 'M-5-165Q0-200 5-165L2 0H-2Z', fill: 'url(#nnfdrop-trail)' }, g)
    const spin = el('g', {}, g)
    el('circle', { r: k.halo, fill: 'url(#nnfdrop-halo)' }, spin)
    el('use', { href: '#nnfdrop-piece' }, spin)
    const glint = el('use', { href: '#nnfdrop-star', transform: k.glint }, spin)
    pieces.push({
      g, spin, trail, glint, shown: false,
      born: 0.15 + Math.pow(i / Math.max(1, n - 1), 0.88) * rainFor,
      x: rand(w * 0.02, w * 0.98),
      size: rand(k.size[0], k.size[1]) * (i % k.bigEvery === 0 ? k.big : 1) * k.scale,
      speed: rand(400, 570), drift: rand(-95, 95), phase: rand(0, 6.28),
      rotate: rand(-k.rotate, k.rotate), turn: rand(-k.turn, k.turn)
    })
  }

  const sparkles: Sparkle[] = []
  const dustCount = Math.max(25, Math.round(170 * Math.min(1, (w * h) / (1600 * 900)) * Math.max(0.5, rainFor / BASE_RAIN)))
  for (let i = 0; i < dustCount; i++) {
    const node = el('use', { href: '#nnfdrop-star', opacity: 0 }, dust)
    sparkles.push({ n: node, x: rand(0, w), y: rand(30, h - 30), born: rand(0.4, rainFor + 0.6), life: rand(0.35, 0.9), size: rand(0.15, 0.55), angle: rand(0, 180), shown: false })
  }

  // the last piece is born at rainFor + 0.15 s; give the slowest one time to fall out of sight
  const bottom = h + 120
  const slowest = (-400 * fall + Math.sqrt((400 * fall) ** 2 + 4 * 100 * fall * (bottom + 60))) / (2 * 100 * fall)
  const duration = rainFor + 0.15 + slowest + 0.1

  host.appendChild(svg)

  const render = (t: number): void => {
    const fade = 1 - smooth((t - (duration - 0.4)) / 0.4)
    for (const p of pieces) {
      const age = t - p.born
      const y = -60 + (p.speed * age + 100 * age * age) * fall
      const alpha = age < 0 || y > bottom ? 0 : ease(age / 0.22) * fade
      if (!alpha) {
        if (p.shown) { p.g.setAttribute('opacity', '0'); p.shown = false }
        continue
      }
      p.shown = true
      const x = p.x + Math.sin(age * 2.8 + p.phase) * k.sway * across + p.drift * age * across
      p.g.setAttribute('opacity', alpha.toFixed(3))
      p.g.setAttribute('transform', `translate(${x.toFixed(1)} ${y.toFixed(1)}) scale(${p.size.toFixed(3)})`)
      p.spin.setAttribute('transform', k.spin(p, age))
      p.trail.setAttribute('opacity', (0.3 + 0.25 * Math.sin(age * 4 + p.phase)).toFixed(3))
      p.glint.setAttribute('opacity', Math.pow(Math.max(0, Math.sin(age * 6 + p.phase)), 8).toFixed(3))
    }
    for (const s of sparkles) {
      const u = (t - s.born) / s.life
      const a = u > 0 && u < 1 ? Math.sin(u * Math.PI) * fade : 0
      if (!a) {
        if (s.shown) { s.n.setAttribute('opacity', '0'); s.shown = false }
        continue
      }
      s.shown = true
      s.n.setAttribute('opacity', a.toFixed(3))
      s.n.setAttribute('transform', `translate(${s.x.toFixed(1)} ${(s.y + u * 45).toFixed(1)}) rotate(${(s.angle + u * 90).toFixed(1)}) scale(${(s.size * a).toFixed(3)})`)
    }
  }

  let raf = 0
  let done = false
  const start = performance.now()
  const finish = (): void => {
    if (done) return
    done = true
    cancelAnimationFrame(raf)
    svg.remove()
  }
  const frame = (now: number): void => {
    const t = (now - start) / 1000
    if (t >= duration) {
      finish()
      onEnd()
      return
    }
    render(t)
    raf = requestAnimationFrame(frame)
  }
  render(0)
  raf = requestAnimationFrame(frame)
  return finish
}
