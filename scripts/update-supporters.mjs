// Rebuilds shared/supporters.json (the Support page) from GitHub Sponsors and
// shared/supporters-manual.json. Run by .github/workflows/supporters.yml every 30 minutes; the app
// reads the result from GitHub.
//
//   SPONSORS_TOKEN=... node scripts/update-supporters.mjs
//
// GitHub Sponsors show on their own (real GitHub accounts, no free-text notes): name, picture and
// everything they've given so far. Sponsors who chose to be private never show. Needs SPONSORS_TOKEN,
// a classic token of the sponsored account with the read:user and read:org scopes. Without it, the
// sponsors already in the file are kept as they are.
//
// Buy Me a Coffee is NOT read on purpose: that page is the streamer's own stream tip jar, where
// trolls use fake names and rude notes, so nothing from it ever shows in the app.
//
// supporters-manual.json, all optional:
//   { "name": "Someone", "amount": 20, "currency": "EUR", "avatar": "https://...", "url": "https://..." }
//     a supporter added by hand (money given some other way)
//   { "name": "emaspa", "collaborator": true, "title": "Senior Dev",
//     "projects": [{ "name": "OpenXLR", "url": "https://github.com/..." }], "amount": 300, "currency": "EUR", "avatar": "...", "url": "..." }
//     goes in the Collaborators section ("Senior Dev & creator of OpenXLR"); projects and amount are optional.
// Names and notes go through shared/moderation.ts.

import { readFile, writeFile } from 'node:fs/promises'
import { safeMessage, safeName, ANONYMOUS } from '../shared/moderation.ts'

const OUT = new URL('../shared/supporters.json', import.meta.url)
const MANUAL = new URL('../shared/supporters-manual.json', import.meta.url)

const ghToken = process.env.SPONSORS_TOKEN?.trim()
const https = (v) => {
  try { return typeof v === 'string' && new URL(v).protocol === 'https:' ? v : undefined } catch { return undefined }
}

let manual = []
try {
  manual = JSON.parse(await readFile(MANUAL, 'utf8'))
} catch (e) {
  if (e.code !== 'ENOENT') throw e
}
manual = Array.isArray(manual) ? manual.filter((m) => m?.name) : []
const before = await readFile(OUT, 'utf8').catch(() => '')

// GitHub Sponsors: who's public (from the sponsorships list, private ones left out), joined with
// what each has given in total. Someone missing from the public list is never shown.
async function gql(query, variables) {
  const res = await fetch('https://api.github.com/graphql', {
    method: 'POST',
    headers: { Authorization: `Bearer ${ghToken}`, 'Content-Type': 'application/json', 'User-Agent': 'multichat-control-supporters' },
    body: JSON.stringify({ query, variables })
  })
  const body = await res.json().catch(() => null)
  if (!res.ok || body?.errors?.length) throw new Error(`GitHub answered ${res.status}: ${JSON.stringify(body?.errors ?? body)?.slice(0, 300)}`)
  return body.data
}
async function pages(field, args, select) {
  const out = []
  let after = null
  for (let i = 0; i < 20; i++) {
    const d = await gql(`query($after: String) { viewer { ${field}(first: 100, after: $after${args}) { nodes { ${select} } pageInfo { hasNextPage endCursor } } } }`, { after })
    const c = d?.viewer?.[field]
    out.push(...(c?.nodes ?? []))
    if (!c?.pageInfo?.hasNextPage) break
    after = c.pageInfo.endCursor
  }
  return out
}
const ACCOUNT = '... on User { login name avatarUrl url } ... on Organization { login name avatarUrl url }'

let sponsors = []
if (ghToken) {
  const publicOnes = await pages('sponsorshipsAsMaintainer', ', activeOnly: false, includePrivate: false', `privacyLevel sponsorEntity { ${ACCOUNT} }`)
  const shown = new Map(publicOnes.filter((s) => s?.privacyLevel === 'PUBLIC' && s.sponsorEntity?.login).map((s) => [s.sponsorEntity.login.toLowerCase(), s.sponsorEntity]))
  const totals = await pages('lifetimeReceivedSponsorshipValues', '', `amountInCents sponsor { ${ACCOUNT} }`)
  for (const t of totals) {
    const who = shown.get(String(t?.sponsor?.login ?? '').toLowerCase())
    const amount = Math.round(Number(t?.amountInCents) || 0) / 100
    if (!who || !(amount > 0)) continue
    const name = safeName(who.name || who.login)
    if (name === ANONYMOUS) continue
    sponsors.push({ name, amount, currency: 'USD', avatar: https(who.avatarUrl), url: https(who.url), source: 'github' })
  }
  console.log(`Read ${totals.length} GitHub sponsors; ${sponsors.length} public, shown.`)
} else {
  // no token (not set yet, or expired): keep the sponsors from the last good run
  try { sponsors = JSON.parse(before).filter((x) => x?.source === 'github') } catch { sponsors = [] }
  console.log(`SPONSORS_TOKEN not set: kept ${sponsors.length} GitHub sponsors from the last run.`)
}

const list = [...sponsors]
for (const m of manual.filter((x) => !x.collaborator)) {
  const name = safeName(m.name)
  if (name === ANONYMOUS || !(Number(m.amount) > 0)) continue
  list.push({
    name, amount: Math.round(Number(m.amount) * 100) / 100, currency: String(m.currency || 'EUR').toUpperCase(),
    message: safeMessage(m.message), avatar: https(m.avatar), url: https(m.url), title: safeMessage(m.title)?.slice(0, 60)
  })
}
// biggest first, then by name so the file doesn't reshuffle between runs
list.sort((a, b) => b.amount - a.amount || a.name.localeCompare(b.name))
// collaborators after them, in the order they're listed
for (const m of manual.filter((x) => x.collaborator)) {
  const name = safeName(m.name)
  if (name === ANONYMOUS) continue
  const gave = Number(m.amount) > 0
  list.push({
    name, collaborator: true, title: safeMessage(m.title)?.slice(0, 60),
    projects: (Array.isArray(m.projects) ? m.projects : []).map((x) => ({ name: safeMessage(x?.name)?.slice(0, 40), url: https(x?.url) })).filter((x) => x.name),
    amount: gave ? Number(m.amount) : undefined, currency: gave ? String(m.currency || 'EUR').toUpperCase() : undefined, avatar: https(m.avatar), url: https(m.url)
  })
}
const clean = list.map((x) => Object.fromEntries(Object.entries(x).filter(([, v]) => v !== undefined)))
const next = `${JSON.stringify(clean, null, 2)}\n`
if (next === before) console.log('No change.')
else {
  await writeFile(OUT, next)
  console.log(`Wrote ${clean.length} supporters.`)
}
