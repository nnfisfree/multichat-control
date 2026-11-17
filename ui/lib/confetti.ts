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
}

const GRAVITY = 0.32
const DRAG = 0.972
const MAX_PIECES = 600
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
  const drag = DRAG ** dt
  pieces = pieces.filter((p) => {
    p.age += dt * 16.67
    if (p.age >= p.life) return false
    p.vx *= drag
    p.vy = p.vy * drag + GRAVITY * dt
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

/** Fire a burst from (x, y), in window pixels, aimed up. */
export function confettiBurst(x: number, y: number, count = 110): void {
  if (window.matchMedia?.('(prefers-reduced-motion: reduce)').matches) return
  ensureCanvas()
  // every hover fires, so keep the oldest pieces from piling up past what draws smoothly
  if (pieces.length > MAX_PIECES - count) pieces.splice(0, pieces.length - (MAX_PIECES - count))
  const colors = palette()
  const shapes: Shape[] = ['ribbon', 'ribbon', 'ribbon', 'dot', 'dot', 'spark', 'gem']
  for (let i = 0; i < count; i++) {
    // a cone around straight up, a bit wider than it is tall
    const angle = -Math.PI / 2 + rand(-0.75, 0.75)
    const speed = rand(7, 16) * (0.7 + Math.random() * 0.3)
    pieces.push({
      x: x + rand(-12, 12), y: y + rand(-4, 4),
      vx: Math.cos(angle) * speed, vy: Math.sin(angle) * speed,
      rot: rand(0, Math.PI * 2), spin: rand(-0.2, 0.2),
      flip: rand(0, Math.PI * 2), flipSpeed: rand(0.08, 0.22),
      size: rand(5, 10), color: colors[Math.floor(Math.random() * colors.length)],
      shape: shapes[Math.floor(Math.random() * shapes.length)],
      life: rand(1900, 2900), age: 0
    })
  }
}
