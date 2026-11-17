// Rebuilds shared/supporters.json (the Support page's Wall of Supporters) from Buy Me a Coffee,
// plus the hand-added people in shared/supporters-manual.json. Run by
// .github/workflows/supporters.yml every 30 minutes; the app reads the result from GitHub.
//
//   BMC_TOKEN=... node scripts/update-supporters.mjs
//
// Reads one-time donations and memberships. Privacy: emails are only used in memory to group
// someone's donations together, never written out. Private supports show as "Anonymous supporter"
// with no message; supports sent under several names show as "Anonymous Supporters". Refunds are left out.
// Names and messages go through shared/moderation.ts first.

import { readFile, writeFile } from 'node:fs/promises'
import { safeMessage, safeName, ANONYMOUS } from '../shared/moderation.ts'

const API = 'https://developers.buymeacoffee.com/api/v1'
const OUT = new URL('../shared/supporters.json', import.meta.url)
const MANUAL = new URL('../shared/supporters-manual.json', import.meta.url)
const MAX_PAGES = 100

const token = process.env.BMC_TOKEN?.trim()
if (!token) {
  console.error('BMC_TOKEN is not set. Add it under the repo Settings → Secrets and variables → Actions.')
  process.exit(1)
}

const truthy = (v) => v === true || v === 1 || v === '1' || v === 'true'
// BMC uses 1 for public; 0, 2 or false mean private
const isPublic = (v) => !(v === 0 || v === '0' || v === false || v === 'false' || v === 2 || v === '2')
const https = (v) => {
  try { return typeof v === 'string' && new URL(v).protocol === 'https:' ? v : undefined } catch { return undefined }
}

/** Every page of a BMC list. An empty list comes back as a 404 with an error, which just means none yet. */
async function all(path) {
  const items = []
  let url = `${API}${path}`
  for (let i = 0; url && i < MAX_PAGES; i++) {
    const res = await fetch(url, { headers: { Authorization: `Bearer ${token}`, Accept: 'application/json' } })
    if (res.status === 404) break
    if (!res.ok) throw new Error(`Buy Me a Coffee answered ${res.status} for ${path}`)
    const body = await res.json()
    items.push(...(Array.isArray(body?.data) ? body.data : []))
    url = body?.next_page_url || null
  }
  return items
}

// hand-added people (shared/supporters-manual.json). Each can also claim BMC names through
// `aliases`, so someone who donated as "FAQ U" shows (and adds up) as "G2Warrior".
let manual = []
try {
  manual = JSON.parse(await readFile(MANUAL, 'utf8'))
} catch (e) {
  if (e.code !== 'ENOENT') throw e
}
manual = Array.isArray(manual) ? manual.filter((m) => m?.name) : []
const squash = (s) => String(s ?? '').toLowerCase().replace(/\s*,\s*/g, ',').replace(/\s+/g, ' ').trim()
const aliasOf = new Map()
for (const m of manual) for (const a of Array.isArray(m.aliases) ? m.aliases : []) aliasOf.set(squash(a), m.name)

// a support sent under several names at once ("que voy, Kiski, pufn, ...") is a group: no single name fits
const GROUP = 'Anonymous Supporters'
const isGroup = (n) => (String(n ?? '').match(/,/g) ?? []).length >= 2

/** The name a support shows under, and the key its money adds up on. Emails stay in memory only. */
function who(rawName, visible, email) {
  const claimed = aliasOf.get(squash(rawName))
  if (claimed) return { name: safeName(claimed), key: `m:${claimed.toLowerCase()}` }
  // a group gift gets its own card, so the buyer's own donations stay under their name
  if (visible && isGroup(rawName)) return { name: GROUP, key: `g:${squash(rawName)}` }
  const name = visible ? safeName(rawName) : ANONYMOUS
  return { name, key: email ? `e:${email}` : `n:${name.toLowerCase()}` }
}

const people = new Map()
function add(rawName, visible, email, amount, currency, at, note) {
  if (!(amount > 0)) return
  const { name, key } = who(rawName, visible, String(email ?? '').toLowerCase())
  const p = people.get(key) ?? { name, amount: 0, currency: String(currency || 'EUR').toUpperCase(), at: -1, message: undefined }
  p.amount += amount
  // newest name and message win
  if (at >= p.at) {
    p.at = at
    p.name = name
    const m = visible ? safeMessage(note) : undefined
    if (m) p.message = m
  }
  people.set(key, p)
}
const time = (v) => Date.parse(String(v ?? '').replace(' ', 'T')) || 0

// one-time donations
const supports = await all('/supporters')
for (const s of supports) {
  if (truthy(s?.is_refunded) || truthy(s?.refunded)) continue
  const visible = isPublic(s?.support_visibility)
  add(s?.supporter_name || s?.payer_name, visible, s?.payer_email || s?.support_email,
    (Number(s?.support_coffees) || 1) * (Number(s?.support_coffee_price) || 0), s?.support_currency,
    time(s?.support_created_on), truthy(s?.note_hidden) ? undefined : s?.support_note)
}

// memberships: every period paid so far (same estimate the app's BMC alerts use)
const yearly = (s) => /year|annual/i.test(String(s?.subscription_duration_type ?? ''))
const subs = await all('/subscriptions?status=all')
for (const s of subs) {
  const step = yearly(s) ? 12 : 1
  const start = time(s?.subscription_created_on)
  const period = time(s?.subscription_current_period_start)
  const months = start && period > start ? Math.round((period - start) / (30.436875 * 86_400_000)) : 0
  const periods = Math.floor(months / step) + 1
  const price = (Number(s?.subscription_coffee_price) || 0) * (Number(s?.subscription_coffee_num) || 1)
  add(s?.payer_name || s?.supporter_name, isPublic(s?.message_visibility) || s?.message_visibility === undefined, s?.payer_email,
    price * periods, s?.subscription_currency, period || start, s?.subscription_message)
}
console.log(`Read ${supports.length} donations and ${subs.length} memberships from Buy Me a Coffee.`)

// manual people: ones matching a BMC name get their picture/link/message, the rest are added as-is
const list = [...people.values()].map(({ name, amount, currency, message }) => ({ name, amount: Math.round(amount * 100) / 100, currency, message }))
for (const m of manual) {
  const name = safeName(m.name)
  const extra = { avatar: https(m.avatar), url: https(m.url), message: safeMessage(m.message), title: safeMessage(m.title)?.slice(0, 60) }
  const hit = name !== ANONYMOUS && list.find((x) => x.name.toLowerCase() === name.toLowerCase())
  if (hit) Object.assign(hit, Object.fromEntries(Object.entries(extra).filter(([, v]) => v)))
  else if (Number(m.amount) > 0) list.push({ name, amount: Number(m.amount), currency: String(m.currency || 'EUR').toUpperCase(), ...extra })
}

// biggest first, then by name so the file doesn't reshuffle between runs
list.sort((a, b) => b.amount - a.amount || a.name.localeCompare(b.name))
const clean = list.map((x) => Object.fromEntries(Object.entries(x).filter(([, v]) => v !== undefined)))
const next = `${JSON.stringify(clean, null, 2)}\n`
const before = await readFile(OUT, 'utf8').catch(() => '')
if (next === before) console.log('No change.')
else {
  await writeFile(OUT, next)
  console.log(`Wrote ${clean.length} supporters.`)
}
