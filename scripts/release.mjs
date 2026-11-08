// Builds, checks and publishes a release to GitHub.
//   npm run release -- --notes notes.md          publish a normal release
//   npm run release -- --notes notes.md --pre    publish a test version (pre-release)
// The version comes from package.json. Everything is checked before anything is uploaded.
import { execFileSync, execSync, spawnSync } from 'node:child_process'
import { existsSync, mkdtempSync, readFileSync, readdirSync, rmSync, statSync } from 'node:fs'
import { homedir, tmpdir, userInfo } from 'node:os'
import { join, relative, resolve } from 'node:path'

const root = resolve(import.meta.dirname, '..')
const args = process.argv.slice(2)
const notesFile = args.includes('--notes') ? args[args.indexOf('--notes') + 1] : null
const pre = args.includes('--pre')
const pkg = JSON.parse(readFileSync(join(root, 'package.json'), 'utf8'))
const repo = /github\.com\/([^/]+\/[^/.]+)/.exec(pkg.repository?.url ?? '')?.[1]
const version = pkg.version
const tag = `v${version}`
const files = [`Multichat-Control-${version}-x64.zip`, `Multichat-Control-${version}-portable.exe`]

const step = (text) => console.log(`\n▸ ${text}`)
const stop = (text) => {
  console.error(`\n✖ ${text}\nNothing was published.`)
  process.exit(1)
}
const git = (...a) => execFileSync('git', a, { cwd: root, encoding: 'utf8' }).trim()

// 1. The release must match what is on GitHub.
step(`Preparing ${tag} for ${repo}`)
if (!repo) stop('package.json has no GitHub repository URL.')
if (!notesFile || !existsSync(notesFile)) stop('Add release notes: npm run release -- --notes notes.md')
if (git('status', '--porcelain')) stop('There are uncommitted changes. Commit them first.')
git('fetch', 'origin')
if (git('rev-parse', 'HEAD') !== git('rev-parse', '@{u}')) stop('Your commits are not all pushed. Push first, so the release matches GitHub.')
if (!existsSync(join(root, '.env.local'))) console.warn('  Note: no .env.local, so YouTube and Kick logins will not be built in.')

const token = /^password=(.*)$/m.exec(execSync('git credential fill', { input: 'protocol=https\nhost=github.com\n\n', encoding: 'utf8', env: { ...process.env, GIT_TERMINAL_PROMPT: '0' } }))?.[1]
if (!token) stop('No GitHub login found. Push once with git to sign in.')
const headers = { Authorization: `Bearer ${token}`, Accept: 'application/vnd.github+json', 'User-Agent': 'multichat-release' }
// The build takes minutes, and GitHub drops idle connections meanwhile, so a dropped
// connection is retried. A request that never got an answer is safe to send again.
const send = async (url, init) => {
  for (let attempt = 1; ; attempt++) {
    try {
      return await fetch(url, init)
    } catch (err) {
      if (attempt >= 4) throw err
      console.log(`  connection dropped (${err.cause?.code ?? err.message}), retrying…`)
      await new Promise((r) => setTimeout(r, 2000 * attempt))
    }
  }
}
const api = async (method, path, body) => {
  const r = await send(`https://api.github.com/repos/${repo}${path}`, { method, headers, body: body ? JSON.stringify(body) : undefined })
  return { status: r.status, json: await r.json().catch(() => null) }
}
if ((await api('GET', `/releases/tags/${tag}`)).status === 200) stop(`${tag} already exists. Raise the version in package.json first.`)

// 2. Build from clean, so nothing left over from tests or earlier builds can ship.
step('Building from clean')
for (const dir of ['out', 'release']) rmSync(join(root, dir), { recursive: true, force: true })
for (const cmd of ['npx electron-vite build', 'npx electron-builder --win']) {
  const r = spawnSync(cmd, { cwd: root, shell: true, stdio: 'inherit', env: { ...process.env, ELECTRON_RUN_AS_NODE: '' } })
  if (r.status !== 0) stop(`Build failed: ${cmd}`)
}
for (const f of files) if (!existsSync(join(root, 'release', f))) stop(`Missing build output: ${f}`)

// 3. Privacy audit of exactly what will be uploaded.
step('Checking the release for personal data')
const work = mkdtempSync(join(tmpdir(), 'release-audit-'))
try {
  execFileSync('tar', ['-xf', join(root, 'release', files[0]), '-C', work])
  const asar = (await import('@electron/asar')).default
  asar.extractAll(join(work, 'resources', 'app.asar'), join(work, '_app'))
  const walk = (d) => readdirSync(d, { withFileTypes: true }).flatMap((e) => (e.isDirectory() ? walk(join(d, e.name)) : [join(d, e.name)]))
  const all = walk(work).filter((f) => !f.endsWith('app.asar'))
  const badPath = /nnf-data|\.env|screenshots|e2e|\.log$|secrets\.json|settings\.json|cookies|emote-cache|[\\/]tests?[\\/]/i
  const forbidden = all.map((f) => relative(work, f)).filter((f) => badPath.test(f))
  if (forbidden.length) stop(`Files that must not ship:\n  ${forbidden.slice(0, 10).join('\n  ')}`)
  const needles = [homedir(), homedir().replace(/\\/g, '/'), root, root.replace(/\\/g, '/'), `\\Users\\${userInfo().username}\\`].map((s) => s.toLowerCase())
  for (const f of all) {
    if (statSync(f).size > 200 * 1024 * 1024) continue
    const text = readFileSync(f).toString('latin1').toLowerCase()
    const hit = needles.find((n) => text.includes(n))
    if (hit) stop(`A file contains a local path from this PC: ${relative(work, f)}`)
  }
  console.log(`  ${all.length} files checked: no local paths, logins or test files.`)
} finally {
  rmSync(work, { recursive: true, force: true })
}

// 4. Publish.
step(`Publishing ${tag}${pre ? ' as a test version' : ''}`)
const made = await api('POST', '/releases', {
  tag_name: tag, target_commitish: git('rev-parse', 'HEAD'), name: `Multichat Control ${version}`,
  body: readFileSync(notesFile, 'utf8'), prerelease: pre, draft: false
})
if (made.status !== 201) stop(`GitHub refused the release: ${made.json?.message}`)
for (const f of files) {
  const data = readFileSync(join(root, 'release', f))
  const r = await send(`https://uploads.github.com/repos/${repo}/releases/${made.json.id}/assets?name=${encodeURIComponent(f)}`, {
    method: 'POST', headers: { ...headers, 'Content-Type': 'application/octet-stream', 'Content-Length': String(data.length) }, body: data
  })
  const asset = await r.json()
  if (r.status !== 201 || asset.size !== data.length) stop(`Upload failed for ${f}. The release exists but is incomplete; delete it on GitHub and try again.`)
  console.log(`  uploaded ${f} (${Math.round(data.length / 1048576)} MB)`)
}
console.log(`\n✔ Published: ${made.json.html_url}`)
