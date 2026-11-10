// Builds, checks and publishes a release to GitHub.
//   npm run release -- --notes notes.md          publish a normal release
//   npm run release -- --notes notes.md --pre    publish a test version (pre-release)
//   npm run release -- --dry                     build and check only, publish nothing
// The version comes from package.json. Everything is checked before anything is uploaded.
//
// Two downloads are published, and both are needed:
//   Multichat-Control-<v>-portable.exe   the app itself: one file. New users and v0.2+ updates use it.
//   Multichat-Control-<v>-x64.zip        for copies of 0.1.x (Electron) installed from the zip: their
//                                        updater only takes a zip holding resources/app.asar, so a
//                                        tiny placeholder is included. The new app deletes it on start.
import { execFileSync, execSync, spawnSync } from 'node:child_process'
import { copyFileSync, existsSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, rmSync, statSync, writeFileSync } from 'node:fs'
import { homedir, tmpdir, userInfo } from 'node:os'
import { join, relative, resolve } from 'node:path'

const root = resolve(import.meta.dirname, '..')
const args = process.argv.slice(2)
const dry = args.includes('--dry')
const pre = args.includes('--pre')
const notesFile = args.includes('--notes') ? args[args.indexOf('--notes') + 1] : null
const pkg = JSON.parse(readFileSync(join(root, 'package.json'), 'utf8'))
const repo = /github\.com\/([^/]+\/[^/.]+)/.exec(pkg.repository?.url ?? '')?.[1]
const version = pkg.version
const tag = `v${version}`
const out = join(root, 'release')
const EXE = 'Multichat-Control.exe'
const files = { exe: `Multichat-Control-${version}-portable.exe`, zip: `Multichat-Control-${version}-x64.zip` }

const step = (text) => console.log(`\n▸ ${text}`)
const stop = (text) => {
  console.error(`\n✖ ${text}\nNothing was published.`)
  process.exit(1)
}
const git = (...a) => execFileSync('git', a, { cwd: root, encoding: 'utf8' }).trim()

// 1. The release must match what is on GitHub, and every version number must agree.
step(`Preparing ${tag} for ${repo}${dry ? ' (dry run: nothing is published)' : ''}`)
if (!repo) stop('package.json has no GitHub repository URL.')
const cargo = /^version\s*=\s*"([^"]+)"/m.exec(readFileSync(join(root, 'core', 'Cargo.toml'), 'utf8'))?.[1]
const conf = JSON.parse(readFileSync(join(root, 'core', 'tauri.conf.json'), 'utf8')).version
if (cargo !== version || conf !== version) stop(`Versions disagree: package.json ${version}, core/Cargo.toml ${cargo}, core/tauri.conf.json ${conf}.`)
if (!existsSync(join(root, '.env.local'))) console.warn('  Note: no .env.local, so YouTube, Kick and alert logins will not be built in.')

let api, send, headers
if (!dry) {
  if (!notesFile || !existsSync(notesFile)) stop('Add release notes: npm run release -- --notes notes.md')
  if (git('status', '--porcelain')) stop('There are uncommitted changes. Commit them first.')
  git('fetch', 'origin')
  if (git('rev-parse', 'HEAD') !== git('rev-parse', '@{u}')) stop('Your commits are not all pushed. Push first, so the release matches GitHub.')
  const token = /^password=(.*)$/m.exec(execSync('git credential fill', { input: 'protocol=https\nhost=github.com\n\n', encoding: 'utf8', env: { ...process.env, GIT_TERMINAL_PROMPT: '0' } }))?.[1]
  if (!token) stop('No GitHub login found. Push once with git to sign in.')
  headers = { Authorization: `Bearer ${token}`, Accept: 'application/vnd.github+json', 'User-Agent': 'multichat-release' }
  // The build takes minutes, and GitHub drops idle connections meanwhile, so a dropped
  // connection is retried. A request that never got an answer is safe to send again.
  send = async (url, init) => {
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
  api = async (method, path, body) => {
    const r = await send(`https://api.github.com/repos/${repo}${path}`, { method, headers, body: body ? JSON.stringify(body) : undefined })
    return { status: r.status, json: await r.json().catch(() => null) }
  }
  if ((await api('GET', `/releases/tags/${tag}`)).status === 200) stop(`${tag} already exists. Raise the version first (package.json, core/Cargo.toml, core/tauri.conf.json).`)
}

// 2. Build from clean, so nothing left over from tests or earlier builds can ship.
step('Building from clean')
const built = join(root, 'core', 'target', 'release', EXE)
for (const p of [out, join(root, 'dist'), built]) rmSync(p, { recursive: true, force: true })
const typecheck = spawnSync('npx tsc --noEmit', { cwd: root, shell: true, stdio: 'inherit' })
if (typecheck.status !== 0) stop('The code has type errors.')
// scripts/build.mjs keeps this PC's folder paths out of the exe.
const build = spawnSync('node scripts/build.mjs', { cwd: root, shell: true, stdio: 'inherit' })
if (build.status !== 0 || !existsSync(built)) stop('Build failed.')

mkdirSync(out, { recursive: true })
copyFileSync(built, join(out, files.exe))
const stage = mkdtempSync(join(tmpdir(), 'release-zip-'))
try {
  copyFileSync(built, join(stage, EXE))
  mkdirSync(join(stage, 'resources'))
  writeFileSync(join(stage, 'resources', 'app.asar'), 'Placeholder that lets version 0.1.x update itself. The app deletes it when it starts.\n')
  const zip = spawnSync('powershell', ['-NoProfile', '-NonInteractive', '-Command', `Compress-Archive -Path '${stage}\\*' -DestinationPath '${join(out, files.zip)}' -Force`], { stdio: 'inherit' })
  if (zip.status !== 0 || !existsSync(join(out, files.zip))) stop('Could not create the zip.')
} finally {
  rmSync(stage, { recursive: true, force: true })
}

// 3. Privacy audit of exactly what will be uploaded, plus the interface built into the exe.
step('Checking the release for personal data')
const work = mkdtempSync(join(tmpdir(), 'release-audit-'))
try {
  const zipped = spawnSync('powershell', ['-NoProfile', '-NonInteractive', '-Command', `Expand-Archive -LiteralPath '${join(out, files.zip)}' -DestinationPath '${work}' -Force`], { stdio: 'inherit' })
  if (zipped.status !== 0) stop('Could not open the zip to check it.')
  const walk = (d) => readdirSync(d, { withFileTypes: true }).flatMap((e) => (e.isDirectory() ? walk(join(d, e.name)) : [join(d, e.name)]))
  const shipped = walk(work).map((f) => relative(work, f).replace(/\\/g, '/')).sort()
  const expected = [EXE, 'resources/app.asar']
  if (JSON.stringify(shipped) !== JSON.stringify(expected)) stop(`The zip must hold exactly ${expected.join(' and ')}, but holds:\n  ${shipped.join('\n  ')}`)
  const all = [join(out, files.exe), ...walk(work), ...walk(join(root, 'dist'))]
  const name = userInfo().username
  const needles = [homedir(), homedir().replace(/\\/g, '/'), root, root.replace(/\\/g, '/'), `\\Users\\${name}\\`, `/Users/${name}/`].map((s) => s.toLowerCase())
  for (const f of all) {
    if (statSync(f).size > 200 * 1024 * 1024) continue
    const text = readFileSync(f).toString('latin1').toLowerCase()
    const hit = needles.find((n) => text.includes(n))
    if (hit) stop(`A file contains a local path from this PC: ${relative(root, f)}`)
  }
  const sizes = Object.values(files).map((f) => `${f} (${(statSync(join(out, f)).size / 1048576).toFixed(1)} MB)`)
  console.log(`  ${all.length} files checked: no local paths, logins or test files.\n  ${sizes.join('\n  ')}`)
} finally {
  rmSync(work, { recursive: true, force: true })
}

if (dry) {
  console.log(`\n✔ Dry run finished. The files are in ${relative(process.cwd(), out) || out}. Nothing was published.`)
  process.exit(0)
}

// 4. Publish. The updaters only install files that carry GitHub's SHA-256 checksum.
step(`Publishing ${tag}${pre ? ' as a test version' : ''}`)
const made = await api('POST', '/releases', {
  tag_name: tag, target_commitish: git('rev-parse', 'HEAD'), name: `Multichat Control ${version}`,
  body: readFileSync(notesFile, 'utf8'), prerelease: pre, draft: false
})
if (made.status !== 201) stop(`GitHub refused the release: ${made.json?.message}`)
for (const f of [files.exe, files.zip]) {
  const data = readFileSync(join(out, f))
  const r = await send(`https://uploads.github.com/repos/${repo}/releases/${made.json.id}/assets?name=${encodeURIComponent(f)}`, {
    method: 'POST', headers: { ...headers, 'Content-Type': 'application/octet-stream', 'Content-Length': String(data.length) }, body: data
  })
  const asset = await r.json()
  if (r.status !== 201 || asset.size !== data.length) stop(`Upload failed for ${f}. The release exists but is incomplete; delete it on GitHub and try again.`)
  console.log(`  uploaded ${f} (${(data.length / 1048576).toFixed(1)} MB)`)
}
// GitHub adds each file's checksum shortly after the upload.
await new Promise((r) => setTimeout(r, 3000))
const assets = (await api('GET', `/releases/${made.json.id}/assets`)).json ?? []
const missing = assets.filter((a) => !/^sha256:[0-9a-f]{64}$/i.test(a.digest ?? '')).map((a) => a.name)
if (missing.length) console.warn(`  Warning: GitHub shows no checksum yet for ${missing.join(', ')}. Updates need it; check the release page in a minute.`)
console.log(`\n✔ Published: ${made.json.html_url}`)
