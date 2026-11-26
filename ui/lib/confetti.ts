/**
 * A small confetti cannon: ribbons, dots, sparkles and little gems shot up from a point, tumbling
 * in 3D, falling with gravity and fading out. Drawn on one temporary full-window canvas that only
 * exists while pieces are in the air, so it costs nothing the rest of the time.
 */

type Shape = 'ribbon' | 'dot' | 'spark' | 'gem'
interface Piece {
  x: number; y: number; vx: number; vy: number
  rot: number; spin: number; flip: number; flipSpeed: number
  size: number; color: string; shape: Shape; life: number; age: number
  /** Set on follow confetti, so it can be cleared without touching the support buttons' bursts. */
  sides?: boolean
  /** Own physics (follow confetti floats): gravity, drag per frame, random flutter per frame. */
  g?: number; drag?: number; jx?: number; jy?: number
}

const GRAVITY = 0.32
const DRAG = 0.972
const MAX_PIECES = 1600
let canvas: HTMLCanvasElement | null = null
let pieces: Piece[] = []
let frame = 0
let last = 0

const rand = (a: number, b: number): number => a + Math.random() * (b - a)

/** The skin's accents, plus coffee gold and a bit of white so it sparkles on every skin. */
function palette(): string[] {
  const css = getComputedStyle(document.documentElement)
  const v = (n: string, f: string): string => css.getPropertyValue(n).trim() || f
  return [v('--purple', '#8d1fc8'), v('--purple-2', '#c86bff'), v('--blue', '#2f7cf6'), v('--blue-2', '#52bff2'), '#ffdd00', '#ff73c8', '#ffffff']
}

function draw(ctx: CanvasRenderingContext2D, p: Piece): void {
  const fade = Math.min(1, (p.life - p.age) / (p.life * 0.3))
  ctx.save()
  ctx.globalAlpha = Math.max(0, fade)
  ctx.translate(p.x, p.y)
  ctx.rotate(p.rot)
  // squash on one axis to fake the piece flipping over in 3D
  ctx.scale(1, Math.cos(p.flip))
  ctx.fillStyle = p.color
  const s = p.size
  if (p.shape === 'ribbon') ctx.fillRect(-s * 0.35, -s, s * 0.7, s * 2)
  else if (p.shape === 'dot') { ctx.beginPath(); ctx.arc(0, 0, s * 0.55, 0, Math.PI * 2); ctx.fill() }
  else if (p.shape === 'gem') {
    ctx.beginPath(); ctx.moveTo(0, -s); ctx.lineTo(s * 0.75, 0); ctx.lineTo(0, s); ctx.lineTo(-s * 0.75, 0); ctx.closePath(); ctx.fill()
    ctx.fillStyle = 'rgba(255, 255, 255, 0.55)'
    ctx.beginPath(); ctx.moveTo(0, -s); ctx.lineTo(s * 0.75, 0); ctx.lineTo(0, 0); ctx.closePath(); ctx.fill()
  } else {
    // four-point sparkle
    ctx.beginPath()
    for (let i = 0; i < 8; i++) {
      const r = i % 2 ? s * 0.28 : s
      const a = (i * Math.PI) / 4
      ctx.lineTo(Math.cos(a) * r, Math.sin(a) * r)
    }
    ctx.closePath(); ctx.fill()
  }
  ctx.restore()
}

function tick(now: number): void {
  if (!canvas) return
  // frame-rate independent: 1 = one 60 fps frame
  const dt = Math.min(3, (now - last) / 16.67 || 1)
  last = now
  const ctx = canvas.getContext('2d')!
  const dpr = window.devicePixelRatio || 1
  ctx.setTransform(dpr, 0, 0, dpr, 0, 0)
  ctx.clearRect(0, 0, canvas.width, canvas.height)
  const dragDefault = DRAG ** dt
  pieces = pieces.filter((p) => {
    p.age += dt * 16.67
    if (p.age >= p.life) return false
    const drag = p.drag ? p.drag ** dt : dragDefault
    p.vx = p.vx * drag + (p.jx ? rand(-p.jx, p.jx) * dt : 0)
    p.vy = p.vy * drag + (p.g ?? GRAVITY) * dt + (p.jy ? rand(-p.jy, p.jy) * dt : 0)
    // pieces drift and sway a little as they fall, like paper
    p.x += (p.vx + Math.sin(p.age / 180 + p.flipSpeed * 40) * 0.35) * dt
    p.y += p.vy * dt
    p.rot += p.spin * dt
    p.flip += p.flipSpeed * dt
    draw(ctx, p)
    return p.y < window.innerHeight + 40
  })
  if (pieces.length) frame = requestAnimationFrame(tick)
  else stop()
}

function stop(): void {
  cancelAnimationFrame(frame)
  canvas?.remove()
  canvas = null
  pieces = []
}

function ensureCanvas(): void {
  if (canvas) return
  const dpr = window.devicePixelRatio || 1
  canvas = document.createElement('canvas')
  canvas.className = 'confetti-layer'
  canvas.width = Math.round(window.innerWidth * dpr)
  canvas.height = Math.round(window.innerHeight * dpr)
  canvas.setAttribute('aria-hidden', 'true')
  document.body.appendChild(canvas)
  last = performance.now()
  frame = requestAnimationFrame(tick)
}

const reducedMotion = (): boolean => !!window.matchMedia?.('(prefers-reduced-motion: reduce)').matches

/** Adds `count` pieces; `launch` gives each one its start, speed and lifetime. */
function spawn(count: number, launch: () => Pick<Piece, 'x' | 'y' | 'vx' | 'vy' | 'life'> & Partial<Pick<Piece, 'sides' | 'g' | 'drag' | 'jx' | 'jy' | 'size'>>): void {
  ensureCanvas()
  // every hover fires, so keep the oldest pieces from piling up past what draws smoothly
  if (pieces.length > MAX_PIECES - count) pieces.splice(0, pieces.length - (MAX_PIECES - count))
  const colors = palette()
  const shapes: Shape[] = ['ribbon', 'ribbon', 'ribbon', 'dot', 'dot', 'spark', 'gem']
  for (let i = 0; i < count; i++) {
    pieces.push({
      rot: rand(0, Math.PI * 2), spin: rand(-0.2, 0.2),
      flip: rand(0, Math.PI * 2), flipSpeed: rand(0.08, 0.22),
      size: rand(5, 10), color: colors[Math.floor(Math.random() * colors.length)],
      ...launch(),
      shape: shapes[Math.floor(Math.random() * shapes.length)],
      age: 0
    })
  }
}

/** Fire a burst from (x, y), in window pixels, aimed up. */
export function confettiBurst(x: number, y: number, count = 110): void {
  if (reducedMotion()) return
  spawn(count, () => {
    // a cone around straight up, a bit wider than it is tall
    const angle = -Math.PI / 2 + rand(-0.75, 0.75)
    const speed = rand(7, 16) * (0.7 + Math.random() * 0.3)
    return { x: x + rand(-12, 12), y: y + rand(-4, 4), vx: Math.cos(angle) * speed, vy: Math.sin(angle) * speed, life: rand(1900, 2900) }
  })
}

/** Where a piece launched with (vx, vy) from (0, 0) peaks, under gravity `g` and drag `d` per frame. */
function apex(vx: number, vy: number, g: number, d: number): { x: number; y: number } {
  let x = 0
  let y = 0
  for (let i = 0; i < 400 && vy < 0; i++) {
    vx *= d
    vy = vy * d + g
    x += vx
    y += vy
  }
  return { x, y }
}

/**
 * The launch angle and speed whose piece peaks `dx` across and `dy` up from where it starts. Drag
 * makes this non-linear, so it's searched for: the speed for the height, the angle for the reach.
 */
function aim(dx: number, dy: number, g: number, d: number): { angle: number; speed: number } {
  let lo = -Math.PI / 2 + 0.01
  let hi = -0.05
  let speed = 0
  for (let i = 0; i < 22; i++) {
    const angle = (lo + hi) / 2
    let s0 = 0
    let s1 = 400
    for (let j = 0; j < 26; j++) {
      const v = (s0 + s1) / 2
      if (-apex(Math.cos(angle) * v, Math.sin(angle) * v, g, d).y < dy) s0 = v
      else s1 = v
    }
    speed = (s0 + s1) / 2
    if (apex(Math.cos(angle) * speed, Math.sin(angle) * speed, g, d).x < dx) lo = angle
    else hi = angle
  }
  return { angle: (lo + hi) / 2, speed }
}

// Follow confetti physics: a hard burst that brakes fast, then paper floating down
const SIDE_DRAG = 0.95

/**
 * Two cannons in the very bottom corners of the window (new Twitch follower). Each shoots a wide cone
 * up and in; within a second the two cones open into one big dome over most of the window, which then
 * floats down slowly like paper, fluttering and spreading as it goes, for about 8 seconds. Everything
 * scales with the window (aim, speed, float, flutter, how many pieces), so it looks the same at any
 * size. For `seconds` above 1 the cannons keep firing smaller volleys that long. The returned function
 * stops the volleys (pieces in the air keep floating).
 */
export function confettiSides(seconds = 1): () => void {
  if (reducedMotion()) return () => {}
  const volley = (share: number): void => {
    const w = window.innerWidth
    const h = window.innerHeight
    // falls at about 5% of the window height a second once the burst has died down
    const g = h * 0.00005
    const jx = w * 0.0005
    const jy = h * 0.0004
    // the middle of the cone peaks a third of the way across, near the top
    const { angle, speed } = aim(w * 0.36, h * 0.92, g, SIDE_DRAG)
    // lots of small pieces, more on a big window, but never more than draws smoothly
    const perSide = Math.round(Math.min(420, Math.max(150, (w * h) / 2500)) * share)
    for (const side of [0, 1]) {
      spawn(perSide, () => {
        // a wide cone, leaning a little more toward the middle than toward the window edge
        const a = angle + rand(-0.22, 0.32)
        // more of them fast, so the top of the dome fills too
        const v = speed * (0.3 + 0.8 * Math.sqrt(Math.random()))
        const vx = Math.cos(a) * v
        return {
          x: side ? w : 0, y: h, vx: side ? -vx : vx, vy: Math.sin(a) * v,
          life: rand(7000, 9500), size: rand(3.5, 7.5), sides: true, g, drag: SIDE_DRAG, jx, jy
        }
      })
    }
  }
  volley(1)
  const extra = Math.max(0, Math.round((seconds - 1) / 0.45))
  if (!extra) return () => {}
  let fired = 0
  const timer = setInterval(() => {
    volley(0.3)
    if (++fired >= extra) clearInterval(timer)
  }, 450)
  return () => clearInterval(timer)
}

/** Removes the follow confetti (Settings opened), leaving any support-button burst alone. */
export function clearConfettiSides(): void {
  pieces = pieces.filter((p) => !p.sides)
}
