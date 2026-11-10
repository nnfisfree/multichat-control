/** Compares versions like 0.1.2 or v0.2.0-beta.1. Returns >0 when a is newer than b. */
export function compareVersions(a: string, b: string): number {
  const parse = (v: string): { nums: number[]; pre: string } => {
    const [main, pre = ''] = v.trim().replace(/^v/i, '').split('-', 2)
    return { nums: main.split('.').map((n) => Number.parseInt(n, 10) || 0), pre }
  }
  const x = parse(a)
  const y = parse(b)
  for (let i = 0; i < 3; i++) {
    const d = (x.nums[i] ?? 0) - (y.nums[i] ?? 0)
    if (d) return d
  }
  // A full release is newer than any pre-release of the same version.
  if (x.pre === y.pre) return 0
  if (!x.pre) return 1
  if (!y.pre) return -1
  return x.pre.localeCompare(y.pre, undefined, { numeric: true })
}
