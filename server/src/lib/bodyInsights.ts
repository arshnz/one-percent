import { prisma } from './prisma.js'
import { localDate } from './time.js'
import { weekdayOf } from './schedule.js'
import { WEARABLE_METRICS, type WearableMetric } from './wearableMetrics.js'
import {
  benjaminiHochberg, circularSdMinutes, circularStats, median,
  mulberry32, permutationTest,
} from './stats.js'

// What Garmin has the data for but doesn't tell you.
//
// Everything here works from Garmin data alone — no habit logs — which is the
// point: the habit-linked analysis in habitEffect.ts is only as good as how
// long you have been logging habits, and that is the slow ingredient.
//
// Same honesty rules as habitEffect.ts throughout: a minimum sample, a
// permutation test rather than an eyeballed difference, and — new here, because
// these analyses test many things at once — a false-discovery-rate correction.
// Testing five metrics across seven weekdays is thirty-five tests; at p<0.05
// about two will look real from noise alone. Without the correction, "find me
// patterns" is a machine for manufacturing them.

const MIN_DAYS = 20
const FDR_Q = 0.10
// Screening iterations — see the note on permutationTest's `iterations`.
const SCAN_ITER = 2_500

export interface Finding {
  kind: 'sleep_regularity' | 'activity_impact' | 'weekday' | 'baseline_shift'
  headline: string
  detail: string
  /** Present when a statistical test backs it; absent for descriptive findings. */
  pValue?: number
  metric?: WearableMetric
}

type DayRow = {
  date: string
  sleepMinutes: number | null
  sleepStartMin: number | null
  restingHr: number | null
  hrvNight: number | null
  bodyBatteryHigh: number | null
  stressAvg: number | null
}

const num = (v: unknown): number | null =>
  typeof v === 'number' && Number.isFinite(v) ? v : null

const fmtClock = (minsOfDay: number) => {
  const m = ((Math.round(minsOfDay) % 1440) + 1440) % 1440
  return `${String(Math.floor(m / 60)).padStart(2, '0')}:${String(m % 60).padStart(2, '0')}`
}

const fmtMetric = (k: WearableMetric, v: number) =>
  k === 'sleepMinutes'
    ? `${Math.floor(Math.abs(v) / 60)}h ${String(Math.round(Math.abs(v) % 60)).padStart(2, '0')}m`
    : Math.abs(v).toFixed(WEARABLE_METRICS[k].precision)

const ANALYSED: WearableMetric[] = ['sleepMinutes', 'restingHr', 'hrvNight', 'bodyBatteryHigh', 'stressAvg']

// ── 1. Sleep regularity ──────────────────────────────────────────────────────
// Garmin scores duration and stages. It does not score WHEN you went to bed,
// and the consistency of that is among the better-evidenced sleep measures.
//
// Reuses the circular statistics behind the app's habit Anchoring score, which
// is the same question asked of a different behaviour: how tightly does this
// cluster in the day? A plain average of bedtimes would be nonsense — 23:50 and
// 00:10 average to midday.
export function sleepRegularity(days: DayRow[]): Finding[] {
  const fractions: number[] = []
  for (const d of days) {
    const m = num(d.sleepStartMin)
    if (m !== null) fractions.push(m / 1440)
  }
  if (fractions.length < MIN_DAYS) return []

  const c = circularStats(fractions)
  if (!c) return []

  const sd = circularSdMinutes(c.resultant)
  const typical = fmtClock(c.meanFraction * 1440)

  // Deliberately NOT reported as a 0-100 score. The mean resultant length is
  // wildly nonlinear: 0.96 reads like "96%, excellent" and actually means a
  // spread of about an hour either side, which is not excellent. Minutes are
  // the honest unit here because they are the unit the reader can act on.
  const verdict =
    sd <= 30 ? 'tight — most nights land within half an hour of each other'
      : sd <= 50 ? 'reasonably steady'
      : sd <= 75 ? 'drifting by more than an hour either way'
      : 'very scattered'

  return [{
    kind: 'sleep_regularity',
    headline: `You fall asleep around ${typical}, give or take ${Math.round(sd)} minutes`,
    detail:
      `Across ${fractions.length} nights that spread is ${verdict}. ` +
      `Garmin scores how long and how deeply you slept but never when you started — ` +
      `and the start is the part you actually choose.`,
  }]
}

// ── 2. Activity impact ───────────────────────────────────────────────────────
// What each KIND of session costs you, measured on your own body rather than
// modelled. Garmin gives one generic training-load number; this asks whether
// your HRV is actually down two days after cricket.
export function activityImpact(
  days: DayRow[],
  activities: { type: string; localDate: string; durationSec: number }[]
): Finding[] {
  const byDate = new Map(days.map((d) => [d.date, d]))
  const allDates = days.map((d) => d.date).sort()

  // Every date within `lag` days after a session of this type.
  const shift = (iso: string, n: number) =>
    new Date(Date.parse(iso + 'T00:00:00Z') + n * 86_400_000).toISOString().slice(0, 10)

  const types = new Map<string, string[]>()
  for (const a of activities) {
    const list = types.get(a.type) ?? []
    list.push(a.localDate)
    types.set(a.type, list)
  }

  // Any-activity dates, so the comparison group is genuinely rest.
  const anyActivity = new Set(activities.map((a) => a.localDate))

  const candidates: { type: string; metric: WearableMetric; lag: number; after: number[]; rest: number[] }[] = []

  for (const [type, dates] of types) {
    if (dates.length < 8) continue // too few sessions to say anything
    const sessions = new Set(dates)

    for (const lag of [1, 2]) {
      const afterDates = new Set(dates.map((d) => shift(d, lag)))
      for (const metric of ['hrvNight', 'restingHr', 'bodyBatteryHigh', 'sleepMinutes'] as WearableMetric[]) {
        const after: number[] = []
        const rest: number[] = []
        for (const date of allDates) {
          const v = num((byDate.get(date) as unknown as Record<string, unknown>)?.[metric])
          if (v === null) continue
          if (afterDates.has(date)) { after.push(v); continue }
          // Rest baseline: nothing recorded on the day, the day before, or two before.
          const clean = !anyActivity.has(date) &&
            !anyActivity.has(shift(date, -1)) &&
            !anyActivity.has(shift(date, -2)) &&
            !sessions.has(date)
          if (clean) rest.push(v)
        }
        if (after.length >= 8 && rest.length >= 8) {
          candidates.push({ type, metric, lag, after, rest })
        }
      }
    }
  }
  if (!candidates.length) return []

  const ps = candidates.map((c) => permutationTest(c.after, c.rest, 12345, SCAN_ITER))
  const qs = benjaminiHochberg(ps)

  const out: Finding[] = []
  candidates.forEach((c, i) => {
    if (qs[i] >= FDR_Q) return
    const diff = median(c.after) - median(c.rest)
    const meta = WEARABLE_METRICS[c.metric]
    const dirWord = diff < 0 ? 'lower' : 'higher'
    const better = meta.direction === 'lower_better' ? diff < 0 : diff > 0
    const nice = c.type.replace(/_/g, ' ')
    out.push({
      kind: 'activity_impact',
      metric: c.metric,
      pValue: ps[i],
      headline: `${c.lag === 1 ? 'The day after' : 'Two days after'} ${nice}, your ${meta.inline} is ${fmtMetric(c.metric, diff)} ${dirWord}`,
      detail:
        `Compared with days that had no session in the previous 48 hours ` +
        `(${c.after.length} vs ${c.rest.length} days). ` +
        (better
          ? `That is the direction you would want.`
          : `That is the cost of the session — worth knowing when you plan the next one.`),
    })
  })
  return out
}

// ── 3. Day-of-week patterns ──────────────────────────────────────────────────
// "Your worst sleep is Friday, every Friday." Garmin surfaces this nowhere.
// Thirty-five tests at once, so the FDR correction is doing real work here.
export function weekdayPatterns(days: DayRow[]): Finding[] {
  const NAMES = ['Sundays', 'Mondays', 'Tuesdays', 'Wednesdays', 'Thursdays', 'Fridays', 'Saturdays']

  const candidates: { metric: WearableMetric; wd: number; on: number[]; off: number[] }[] = []
  for (const metric of ANALYSED) {
    for (let wd = 0; wd < 7; wd++) {
      const on: number[] = []
      const off: number[] = []
      for (const d of days) {
        const v = num((d as unknown as Record<string, unknown>)[metric])
        if (v === null) continue
        ;(weekdayOf(d.date) === wd ? on : off).push(v)
      }
      if (on.length >= 8 && off.length >= MIN_DAYS) candidates.push({ metric, wd, on, off })
    }
  }
  if (!candidates.length) return []

  const ps = candidates.map((c) => permutationTest(c.on, c.off, 12345, SCAN_ITER))
  const qs = benjaminiHochberg(ps)

  const out: Finding[] = []
  candidates.forEach((c, i) => {
    if (qs[i] >= FDR_Q) return
    const diff = median(c.on) - median(c.off)
    const meta = WEARABLE_METRICS[c.metric]
    out.push({
      kind: 'weekday',
      metric: c.metric,
      pValue: ps[i],
      headline: `${NAMES[c.wd]} are different: ${meta.inline} runs ${fmtMetric(c.metric, diff)} ${diff < 0 ? 'lower' : 'higher'}`,
      detail:
        `Across ${c.on.length} ${NAMES[c.wd].toLowerCase()} against ${c.off.length} other days. ` +
        `A weekly rhythm is usually something in your calendar rather than something in your body.`,
    })
  })
  return out
}

// ── 4. Baseline shifts ───────────────────────────────────────────────────────
// "Your resting heart rate stepped up in mid-June and never came back."
// Garmin draws a rolling line; it will not tell you the regime changed.
//
// Binary segmentation with a permutation test that accounts for the search.
// This is the subtle one: taking the biggest of ~150 candidate splits and then
// testing THAT split as if it were chosen in advance is how change-point
// detection lies. The null distribution here is built from the same max-over-
// all-splits statistic on shuffled data, so the search is priced in.
export function baselineShifts(days: DayRow[], seed = 4242): Finding[] {
  const MIN_SEGMENT = 21
  const out: Finding[] = []

  for (const metric of ['restingHr', 'hrvNight'] as WearableMetric[]) {
    const series: { date: string; v: number }[] = []
    for (const d of days) {
      const v = num((d as unknown as Record<string, unknown>)[metric])
      if (v !== null) series.push({ date: d.date, v })
    }
    if (series.length < MIN_SEGMENT * 2 + 10) continue

    const values = series.map((s) => s.v)
    const bestSplit = (xs: number[]) => {
      let best = { idx: -1, stat: -1 }
      for (let i = MIN_SEGMENT; i <= xs.length - MIN_SEGMENT; i++) {
        const stat = Math.abs(median(xs.slice(0, i)) - median(xs.slice(i)))
        if (stat > best.stat) best = { idx: i, stat }
      }
      return best
    }

    const observed = bestSplit(values)
    if (observed.idx < 0) continue

    // Null: the same max-over-splits statistic on shuffled series. Fewer
    // iterations than the two-sample test because each one is far more work.
    const rand = mulberry32(seed)
    const ITER = 400
    const buf = [...values]
    let atLeast = 0
    for (let it = 0; it < ITER; it++) {
      for (let i = buf.length - 1; i > 0; i--) {
        const j = Math.floor(rand() * (i + 1))
        const t = buf[i]; buf[i] = buf[j]; buf[j] = t
      }
      if (bestSplit(buf).stat >= observed.stat) atLeast++
    }
    const p = (atLeast + 1) / (ITER + 1)
    if (p >= 0.05) continue

    const before = median(values.slice(0, observed.idx))
    const after = median(values.slice(observed.idx))
    const when = series[observed.idx].date
    const meta = WEARABLE_METRICS[metric]
    const rose = after > before
    const better = meta.direction === 'lower_better' ? !rose : rose

    out.push({
      kind: 'baseline_shift',
      metric,
      pValue: p,
      headline: `Your ${meta.inline} baseline ${rose ? 'stepped up' : 'stepped down'} around ${new Date(when + 'T00:00:00Z').toLocaleDateString('en-NZ', { day: 'numeric', month: 'long', timeZone: 'UTC' })}`,
      detail:
        `${fmtMetric(metric, before)} before, ${fmtMetric(metric, after)} after — and it has not gone back. ` +
        (better
          ? `Whatever changed then is worth keeping.`
          : `Something changed around then. Only you know what; the data just knows when.`),
    })
  }

  return out
}

// ── Everything, for one user ─────────────────────────────────────────────────
export async function computeBodyInsights(userId: string, timezone: string, windowDays = 365) {
  const tz = timezone || 'Pacific/Auckland'
  const today = localDate(new Date(), tz)
  const from = localDate(new Date(Date.now() - windowDays * 86_400_000), tz)

  const [days, activities] = await Promise.all([
    prisma.wearableDay.findMany({
      where: { userId, date: { gte: from, lte: today } },
      select: {
        date: true, sleepMinutes: true, sleepStartMin: true, restingHr: true,
        hrvNight: true, bodyBatteryHigh: true, stressAvg: true,
      },
      orderBy: { date: 'asc' },
    }),
    prisma.wearableActivity.findMany({
      where: { userId, localDate: { gte: from, lte: today } },
      select: { type: true, localDate: true, durationSec: true },
    }),
  ])

  if (days.length < MIN_DAYS) {
    return { days: days.length, findings: [] as Finding[], activityTypes: [] as string[] }
  }

  const findings = [
    ...sleepRegularity(days),
    ...activityImpact(days, activities),
    ...weekdayPatterns(days),
    ...baselineShifts(days),
  ]

  const activityTypes = [...new Set(activities.map((a) => a.type))]
  return { days: days.length, findings, activityTypes }
}
