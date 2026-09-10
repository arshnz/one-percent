import { prisma } from './prisma.js'
import { localDate } from './time.js'
import { parseSchedule, resolveRange, boundsOf, shiftDays } from './schedule.js'
import { WEARABLE_METRICS, type WearableMetric } from './wearableMetrics.js'

// "Does this habit move this number?"
//
// The most useful thing this app can compute, and the easiest thing in it to
// get dishonestly wrong. Three rules hold the line:
//
//   1. A minimum sample in BOTH groups, or it refuses to answer at all.
//   2. A permutation test rather than a raw difference — with 90 noisy days,
//      some difference always exists, and most of them mean nothing.
//   3. The result is an ASSOCIATION. The confound runs backwards as easily as
//      forwards: you train on days you already feel good. Every string this
//      module produces is worded accordingly, and the UI must not "improve" on
//      that wording.

const DEFAULT_WINDOW = 90
// Below this in either group the answer is "not yet", never a number.
const MIN_PER_GROUP = 10
const ITERATIONS = 10_000

export type Verdict = 'insufficient' | 'no_effect' | 'associated'

export interface EffectResult {
  metric: WearableMetric
  label: string
  unit: string
  lagDays: number
  windowDays: number
  hit: { n: number; median: number }
  miss: { n: number; median: number }
  /** hit − miss, in the metric's own units. Sign is raw, not direction-adjusted. */
  difference: number
  /** Two-tailed permutation p-value. */
  pValue: number
  verdict: Verdict
  /** True when the difference runs the way the user would want. Null if undecided. */
  improved: boolean | null
  /** How many more qualifying days are needed, when the verdict is 'insufficient'. */
  needMoreDays?: number
  /** One sentence, already correctly hedged. The UI renders this verbatim. */
  sentence: string
}

// Deterministic RNG: the same data must yield the same p-value on every page
// load, or the number looks like it is drifting on its own.
function mulberry32(seed: number) {
  return function () {
    seed |= 0
    seed = (seed + 0x6d2b79f5) | 0
    let t = Math.imul(seed ^ (seed >>> 15), 1 | seed)
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296
  }
}

function median(xs: number[]): number {
  if (!xs.length) return NaN
  const s = [...xs].sort((a, b) => a - b)
  const mid = s.length >> 1
  return s.length % 2 ? s[mid] : (s[mid - 1] + s[mid]) / 2
}

/**
 * Two-tailed permutation test on the difference of medians.
 *
 * Shuffle which days were "hit" and which were "miss" ten thousand times, and
 * see how often pure chance produces a gap at least as large as the real one.
 * No distributional assumptions, no stats dependency, and it degrades honestly
 * on the small, skewed samples this will actually run on.
 */
export function permutationTest(hit: number[], miss: number[], seed = 12345): number {
  const observed = Math.abs(median(hit) - median(miss))
  const pool = [...hit, ...miss]
  const nHit = hit.length
  const rand = mulberry32(seed)

  let atLeastAsExtreme = 0
  const buf = [...pool]
  for (let it = 0; it < ITERATIONS; it++) {
    // Fisher–Yates over a reused buffer.
    for (let i = buf.length - 1; i > 0; i--) {
      const j = Math.floor(rand() * (i + 1))
      const tmp = buf[i]; buf[i] = buf[j]; buf[j] = tmp
    }
    const d = Math.abs(median(buf.slice(0, nHit)) - median(buf.slice(nHit)))
    if (d >= observed) atLeastAsExtreme++
  }
  // +1 on both sides: with 10k shuffles a p of exactly 0 is not a claim the
  // data can support.
  return (atLeastAsExtreme + 1) / (ITERATIONS + 1)
}

export interface LinkSpec {
  metric: WearableMetric
  lagDays: number
}

/**
 * Every linked metric for one habit, from a single set of queries.
 *
 * Deliberately plural. Computing one metric costs three round-trips to a
 * Postgres that is a long way away; doing that per metric made a five-metric
 * habit eighteen seconds of almost pure network wait. The permutation test
 * itself is ~80ms, so the shape that matters here is round-trips, not maths.
 */
export async function computeHabitEffects(
  habitId: string,
  userId: string,
  links: LinkSpec[],
  timezone: string,
  windowDays = DEFAULT_WINDOW
): Promise<EffectResult[]> {
  if (!links.length) return []

  const tz = timezone || 'Pacific/Auckland'
  const now = new Date()
  const today = localDate(now, tz)
  const from = localDate(new Date(now.getTime() - (windowDays - 1) * 86_400_000), tz)
  const maxLag = Math.max(...links.map((l) => l.lagDays))

  // `userId` comes from the session rather than from the habit row, purely so
  // all three reads can go out together. Looking it up via the habit first cost
  // an extra serial round-trip on every render of the Momentum page.
  const [habit, logs, days] = await Promise.all([
    prisma.habit.findFirst({ where: { id: habitId, workstation: { userId } } }),
    prisma.habitLog.findMany({
      where: { habitId, date: { gte: from, lte: today } },
      select: { date: true, status: true },
    }),
    // Every metric column at once. Five nullable ints over ~90 rows is nothing
    // next to another round-trip each.
    prisma.wearableDay.findMany({
      where: {
        userId,
        date: { gte: from, lte: shiftDays(today, maxLag) },
      },
      select: {
        date: true,
        restingHr: true,
        sleepMinutes: true,
        hrvNight: true,
        bodyBatteryHigh: true,
        stressAvg: true,
      },
    }),
  ])
  if (!habit) return []

  const hitDates = new Set(
    logs.filter((l) => l.status === 'target' || l.status === 'failsafe').map((l) => l.date)
  )

  // The same authority the rhythm score uses, so "a day this habit asked for"
  // means exactly one thing across the whole app: unscheduled days, days before
  // the habit existed and paused stretches are all excluded here.
  const createdOn = localDate(new Date(habit.createdAt), tz)
  const resolved = resolveRange(
    parseSchedule(habit),
    from < createdOn ? createdOn : from,
    today,
    hitDates,
    boundsOf(habit, tz)
  )
  const scheduledDates = resolved
    .filter((d) => d.scheduled && d.date < today) // today can still be logged
    .map((d) => d.date)

  const byDate = new Map(days.map((d) => [d.date, d]))

  return links.map((link) => {
    const hit: number[] = []
    const miss: number[] = []
    for (const date of scheduledDates) {
      const row = byDate.get(shiftDays(date, link.lagDays))
      const v = row ? (row as Record<string, unknown>)[link.metric] : undefined
      if (typeof v !== 'number' || !Number.isFinite(v)) continue
      ;(hitDates.has(date) ? hit : miss).push(v)
    }
    return summarise(link, hit, miss, windowDays)
  })
}

/** Single-metric convenience — used by the CLI check script. */
export async function computeHabitEffect(
  habitId: string,
  userId: string,
  metric: WearableMetric,
  lagDays: number,
  timezone: string,
  windowDays = DEFAULT_WINDOW
): Promise<EffectResult | null> {
  const [r] = await computeHabitEffects(habitId, userId, [{ metric, lagDays }], timezone, windowDays)
  return r ?? null
}

function summarise(
  link: LinkSpec, hit: number[], miss: number[], windowDays: number
): EffectResult {
  const { metric, lagDays } = link
  const meta = WEARABLE_METRICS[metric]
  const base = {
    metric,
    label: meta.label,
    unit: meta.unit,
    lagDays,
    windowDays,
    hit: { n: hit.length, median: median(hit) },
    miss: { n: miss.length, median: median(miss) },
  }

  if (hit.length < MIN_PER_GROUP || miss.length < MIN_PER_GROUP) {
    return {
      ...base,
      difference: 0,
      pValue: 1,
      verdict: 'insufficient',
      improved: null,
      needMoreDays: Math.max(MIN_PER_GROUP - hit.length, MIN_PER_GROUP - miss.length),
      sentence:
        hit.length < MIN_PER_GROUP
          ? `Not enough reps yet to compare — about ${MIN_PER_GROUP - hit.length} more days doing this would make it answerable.`
          : `Not enough missed days to compare against. That is a good problem to have.`,
    }
  }

  const difference = base.hit.median - base.miss.median
  const pValue = permutationTest(hit, miss)
  const improved = meta.direction === 'lower_better' ? difference < 0 : difference > 0
  const size = Math.abs(difference).toFixed(meta.precision)
  const unitStr = meta.unit ? ` ${meta.unit}` : ''
  const when = lagDays === 0 ? 'on days you did this' : 'the day after you did this'

  if (pValue >= 0.05) {
    return {
      ...base,
      difference,
      pValue,
      verdict: 'no_effect',
      improved: null,
      sentence: `No clear difference yet. Over ${windowDays} days, ${meta.inline} ${when} was within the range of ordinary variation.`,
    }
  }

  return {
    ...base,
    difference,
    pValue,
    verdict: 'associated',
    improved,
    // "associated with", never "caused". The reverse explanation — that you do
    // the habit on days you were already going to feel better — fits this data
    // exactly as well, and the sentence must not pretend otherwise.
    sentence: `${when.charAt(0).toUpperCase()}${when.slice(1)}, your ${meta.inline} was ${size}${unitStr} ${difference < 0 ? 'lower' : 'higher'} — bigger than chance would usually produce over ${windowDays} days. That is an association, not proof the habit caused it.`,
  }
}
