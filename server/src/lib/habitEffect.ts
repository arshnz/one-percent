import { prisma } from './prisma.js'
import { localDate } from './time.js'
import { parseSchedule, resolveRange, boundsOf, shiftDays } from './schedule.js'
import { WEARABLE_METRICS, type WearableMetric } from './wearableMetrics.js'
// One permutation test in the codebase — see lib/stats.ts for why.
import { median, permutationTest } from './stats.js'

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

export interface LinkSpec {
  metric: WearableMetric
  lagDays: number
}

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

// ── The other direction ──────────────────────────────────────────────────────
// The effect analysis above asks "did this habit move my body?". This asks the
// reverse: "does how my body was predict whether I showed up?" — the question
// behind an insight like "your misses cluster after short nights".
//
// It is the same shape of claim and gets the same guardrails, because eyeballing
// five bad nights next to five missed days is exactly how a habit app starts
// inventing patterns. The LLM that writes the Momentum insights is handed the
// tested verdict rather than the raw pairs, so it cannot do that arithmetic
// itself and dress a coincidence up as a finding.

export interface MissPredictor {
  metric: WearableMetric
  label: string
  unit: string
  hitDays: { n: number; median: number }
  missDays: { n: number; median: number }
  difference: number
  pValue: number
  verdict: Verdict
  sentence: string
}

/**
 * Day-level, across every active habit. A day counts once: "missed" if any
 * habit it asked for went unlogged, "kept" if all of them were done. Counting
 * per habit-day instead would let one busy day with four habits outvote four
 * ordinary ones.
 *
 * The metric is read on the day itself (lag 0) — Garmin attributes a night's
 * sleep to the morning it ends, so that is already "the night before".
 */
export async function computeMissPredictors(
  wsId: string,
  userId: string,
  timezone: string,
  windowDays = DEFAULT_WINDOW
): Promise<MissPredictor[]> {
  const tz = timezone || 'Pacific/Auckland'
  const now = new Date()
  const today = localDate(now, tz)
  const from = localDate(new Date(now.getTime() - (windowDays - 1) * 86_400_000), tz)

  const [habits, logs, days] = await Promise.all([
    prisma.habit.findMany({ where: { workstationId: wsId, archivedAt: null } }),
    prisma.habitLog.findMany({
      where: { habit: { workstationId: wsId }, date: { gte: from, lte: today } },
      select: { habitId: true, date: true, status: true },
    }),
    prisma.wearableDay.findMany({
      where: { userId, date: { gte: from, lte: today } },
      select: {
        date: true, sleepMinutes: true, bodyBatteryHigh: true,
        hrvNight: true, restingHr: true, stressAvg: true,
      },
    }),
  ])
  if (!habits.length) return []

  const hitKey = new Set(
    logs.filter((l) => l.status === 'target' || l.status === 'failsafe')
      .map((l) => `${l.habitId}|${l.date}`)
  )

  // Per date: how many habits asked, and how many were kept.
  const asked = new Map<string, number>()
  const kept = new Map<string, number>()
  for (const h of habits) {
    const createdOn = localDate(new Date(h.createdAt), tz)
    const hits = new Set(
      logs.filter((l) => l.habitId === h.id && (l.status === 'target' || l.status === 'failsafe'))
        .map((l) => l.date)
    )
    const resolved = resolveRange(
      parseSchedule(h), from < createdOn ? createdOn : from, today, hits, boundsOf(h, tz)
    )
    for (const d of resolved) {
      if (!d.scheduled || d.date >= today) continue // today can still be logged
      asked.set(d.date, (asked.get(d.date) ?? 0) + 1)
      if (hitKey.has(`${h.id}|${d.date}`)) kept.set(d.date, (kept.get(d.date) ?? 0) + 1)
    }
  }

  const byDate = new Map(days.map((d) => [d.date, d as Record<string, unknown>]))
  const out: MissPredictor[] = []

  for (const metric of ['sleepMinutes', 'bodyBatteryHigh', 'hrvNight'] as WearableMetric[]) {
    const hit: number[] = []
    const miss: number[] = []
    for (const [date, n] of asked) {
      const v = byDate.get(date)?.[metric]
      if (typeof v !== 'number' || !Number.isFinite(v)) continue
      ;((kept.get(date) ?? 0) >= n ? hit : miss).push(v)
    }

    const meta = WEARABLE_METRICS[metric]
    const base = {
      metric, label: meta.label, unit: meta.unit,
      hitDays: { n: hit.length, median: median(hit) },
      missDays: { n: miss.length, median: median(miss) },
    }

    if (hit.length < MIN_PER_GROUP || miss.length < MIN_PER_GROUP) {
      out.push({
        ...base, difference: 0, pValue: 1, verdict: 'insufficient',
        sentence: `Not enough of both kinds of day yet to compare ${meta.inline}.`,
      })
      continue
    }

    const difference = base.missDays.median - base.hitDays.median
    const pValue = permutationTest(hit, miss)
    const size = Math.abs(difference).toFixed(meta.precision)
    const unitStr = meta.unit ? ` ${meta.unit}` : ''

    out.push({
      ...base, difference, pValue,
      verdict: pValue < 0.05 ? 'associated' : 'no_effect',
      sentence: pValue < 0.05
        ? `On days you missed something, your ${meta.inline} was ${size}${unitStr} ${difference < 0 ? 'lower' : 'higher'} than on days you kept everything — bigger than chance would usually produce. Which way the causation runs is not something this can tell you.`
        : `No clear difference in ${meta.inline} between the days you kept everything and the days you missed something.`,
    })
  }

  return out
}
