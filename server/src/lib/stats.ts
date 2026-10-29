// The small statistics this app is allowed to do, in one place.
//
// Extracted from habitEffect.ts once a second and third analysis needed the
// same tools. There must be exactly one permutation test in this codebase: the
// honesty of every claim the app makes rests on it, and a second copy would
// eventually drift from the first.


/** Deterministic RNG — the same data must produce the same p-value every time,
 *  or the numbers appear to wander on their own between page loads. */
export function mulberry32(seed: number) {
  return function () {
    seed |= 0
    seed = (seed + 0x6d2b79f5) | 0
    let t = Math.imul(seed ^ (seed >>> 15), 1 | seed)
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296
  }
}

export function median(xs: number[]): number {
  if (!xs.length) return NaN
  const s = [...xs].sort((a, b) => a - b)
  const mid = s.length >> 1
  return s.length % 2 ? s[mid] : (s[mid - 1] + s[mid]) / 2
}

export function mean(xs: number[]): number {
  return xs.length ? xs.reduce((a, b) => a + b, 0) / xs.length : NaN
}

/**
 * Two-tailed permutation test on the difference of medians.
 *
 * Shuffle the group labels ten thousand times and count how often chance alone
 * produces a gap at least as large as the real one. No distributional
 * assumptions, no dependency, and it degrades honestly on the small skewed
 * samples this app actually has.
 */
export function permutationTest(
  a: number[],
  b: number[],
  seed = 12345,
  // 10k gives p to ~0.0001, which matters for a single headline claim. The
  // broad scans in bodyInsights.ts run dozens of tests and then rank them
  // through a false-discovery correction, where relative ordering matters far
  // more than the fourth decimal — they pass a smaller number and run 4x
  // faster for it.
  iterations = 10_000,
): number {
  const observed = Math.abs(median(a) - median(b))
  const nA = a.length
  const buf = [...a, ...b]
  const rand = mulberry32(seed)

  let atLeastAsExtreme = 0
  for (let it = 0; it < iterations; it++) {
    for (let i = buf.length - 1; i > 0; i--) {
      const j = Math.floor(rand() * (i + 1))
      const tmp = buf[i]; buf[i] = buf[j]; buf[j] = tmp
    }
    if (Math.abs(median(buf.slice(0, nA)) - median(buf.slice(nA))) >= observed) atLeastAsExtreme++
  }
  // +1 both sides: p = 0 is not a claim any finite number of shuffles supports.
  return (atLeastAsExtreme + 1) / (iterations + 1)
}

/**
 * Benjamini–Hochberg false-discovery-rate correction.
 *
 * Needed the moment the app started testing many things at once — five metrics
 * across seven weekdays is thirty-five tests, and at p<0.05 roughly two will
 * look "significant" from noise alone. Returns the adjusted q-values in the
 * order given. Without this, scanning for patterns manufactures them.
 */
export function benjaminiHochberg(pValues: number[]): number[] {
  const n = pValues.length
  if (!n) return []
  const order = pValues.map((p, i) => ({ p, i })).sort((x, y) => x.p - y.p)
  const q = new Array<number>(n)
  let prev = 1
  for (let k = n - 1; k >= 0; k--) {
    const adj = Math.min(prev, (order[k].p * n) / (k + 1))
    prev = adj
    q[order[k].i] = Math.min(adj, 1)
  }
  return q
}

/**
 * Circular mean and concentration for times of day, as a fraction of 24h.
 *
 * `resultant` (0–1) is how tightly the times cluster — the same mean-resultant
 * length the habit Anchoring score uses. Handles the midnight wrap, which is
 * the entire reason a plain average of bedtimes is wrong: 23:50 and 00:10 are
 * twenty minutes apart, not twenty-three hours and forty.
 */
export function circularStats(fractions: number[]): { meanFraction: number; resultant: number } | null {
  if (fractions.length < 3) return null
  let sx = 0, sy = 0
  for (const f of fractions) {
    const a = f * 2 * Math.PI
    sx += Math.cos(a)
    sy += Math.sin(a)
  }
  const n = fractions.length
  const resultant = Math.sqrt(sx * sx + sy * sy) / n
  let angle = Math.atan2(sy / n, sx / n)
  if (angle < 0) angle += 2 * Math.PI
  return { meanFraction: angle / (2 * Math.PI), resultant }
}

/** Circular standard deviation in minutes — the readable form of `resultant`. */
export function circularSdMinutes(resultant: number): number {
  if (resultant <= 0) return 720
  if (resultant >= 1) return 0
  return Math.sqrt(-2 * Math.log(resultant)) * (1440 / (2 * Math.PI))
}
