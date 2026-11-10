// Builds the release exe without any trace of the build machine.
//
// Rust keeps source file paths for error messages, and those include the folder of whoever built
// it (for example C:\Users\<name>\.cargo\...). This rewrites them to neutral names at build time.
// The paths are worked out here, never written into a committed file.
import { spawnSync } from 'node:child_process'
import { homedir } from 'node:os'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..')
const cargoHome = process.env.CARGO_HOME || join(homedir(), '.cargo')
const rustupHome = process.env.RUSTUP_HOME || join(homedir(), '.rustup')
const remap = [[cargoHome, 'cargo'], [rustupHome, 'rustup'], [root, 'src'], [homedir(), 'home']]
const flags = remap.map(([from, to]) => `--remap-path-prefix=${from}=${to}`).join(' ')

const extra = process.argv.slice(2)
const result = spawnSync('npx', ['tauri', 'build', '--no-bundle', ...extra], {
  cwd: root,
  stdio: 'inherit',
  shell: true,
  env: { ...process.env, RUSTFLAGS: [process.env.RUSTFLAGS, flags].filter(Boolean).join(' ') }
})
process.exit(result.status ?? 1)
