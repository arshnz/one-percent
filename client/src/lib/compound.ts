import type { Contribution, Momentum } from '@/types'

// The compound curve: 1% better per DAY.
//
// The exponent is days, not reps. A day where you hit everything scheduled is a
// full 1%; hit half your habits and it's half a percent. That keeps the number
// meaning the same thing whether you track one habit or six — counting reps
// would hand someone 3% a day for tracking three habits and compound a year
// into five figures, which is neither the claim in the book nor a number anyone
// can feel.
//
// A perfect year is 1.01^365 = 37.8× — the number the whole idea rests on.
//
// A miss doesn't subtract, it just doesn't add. That's deliberate and
// load-bearing: this app rejects clawback (see momentum.ts, "No streaks,
// ever"). A curve that dropped on a miss would argue the opposite of the
// product.
//
// This pictures compounding. It does not measure the person.
export const RATE = 0.01

export const multiplier = (progressDays: number) => Math.pow(1 + RATE, progressDays)

export interface Point {
  date: string
  value: number
}

export interface Series {
  /** Calendar days from the first scheduled day to today. */
  actual: Point[]
  /** What the curve would read if every scheduled day had been hit. */
  ceiling: Point[]
  /** The exponent behind today's multiplier — full days' worth of progress. */
  progressDays: number
  /** Days that asked something of you (excludes rest days and paused stretches). */
  activeDays: number
}

/** The minimum a habit needs to feed the curve — active or archived alike. */
export interface CurveHabit {
  contributions: Contribution[]
  createdAt?: string
  pausedAt?: string | null
  /** Set once a habit is deleted/retired — its history stays, frozen here. */
  archivedAt?: string | null
}

/**
 * Roll the per-habit grids into one daily progress fraction.
 *
 * Rest days and paused stretches are skipped, not zeroed — a day that asked
 * nothing of you can't be a day you fell behind. Same rule rhythmScore already
 * follows server-side.
 *
 * Archived habits are passed in too: deleting a habit must not erase evidence
 * you already banked, so its past stays in the curve, frozen at the archive
 * date exactly like a pause.
 */
export function progressSeries(habits: CurveHabit[]): Series {
  const byDate = new Map<string, { hit: number; scheduled: number }>()

  for (const h of habits) {
    const pausedOn = h.pausedAt ? h.pausedAt.slice(0, 10) : null
    const createdOn = h.createdAt ? h.createdAt.slice(0, 10) : null
    const archivedOn = h.archivedAt ? h.archivedAt.slice(0, 10) : null
    for (const c of h.contributions) {
      if (!c.scheduled) continue
      // A day before the habit existed was never a day you could have shown up —
      // it must not inflate the ceiling or stretch the curve back in time.
      if (createdOn && c.date < createdOn) continue
      // Frozen at the archive date: past counts, nothing after. Same as a pause.
      if (archivedOn && c.date >= archivedOn) continue
      if (pausedOn && c.date >= pausedOn) continue
      const day = byDate.get(c.date) ?? { hit: 0, scheduled: 0 }
      day.scheduled++
      if (c.count > 0) day.hit++
      byDate.set(c.date, day)
    }
  }

  if (byDate.size === 0) {
    return { actual: [], ceiling: [], progressDays: 0, activeDays: 0 }
  }

  // Walk the calendar rather than only the active days, so the x-axis stays
  // linear in time and a fallow stretch reads as the flat line it was.
  const active = [...byDate.keys()].sort()
  const days = eachDay(active[0], active[active.length - 1])

  let progress = 0
  let ceiling = 0
  const actualPts: Point[] = []
  const ceilingPts: Point[] = []

  for (const date of days) {
    const day = byDate.get(date)
    if (day && day.scheduled > 0) {
      progress += day.hit / day.scheduled
      ceiling += 1
    }
    actualPts.push({ date, value: multiplier(progress) })
    ceilingPts.push({ date, value: multiplier(ceiling) })
  }

  return { actual: actualPts, ceiling: ceilingPts, progressDays: progress, activeDays: ceiling }
}

const DAY_MS = 86_400_000

function eachDay(from: string, to: string): string[] {
  const out: string[] = []
  let t = Date.parse(from + 'T00:00:00Z')
  const end = Date.parse(to + 'T00:00:00Z')
  // Guard a malformed date rather than spinning forever.
  if (!Number.isFinite(t) || !Number.isFinite(end) || end < t) return [from]
  while (t <= end) {
    out.push(new Date(t).toISOString().slice(0, 10))
    t += DAY_MS
  }
  return out
}

/**
 * How many days a week can move the curve at all — the cap on the projection.
 *
 * Fixed-day habits union their weekdays: two habits on a Monday still make
 * Monday one day. A weekly-quota habit has no weekdays to union, so it
 * contributes its quota — that many days a week will ask something of you, even
 * though which ones is up to you. The two are combined with max rather than a
 * sum: a 4×-a-week habit alongside a Mon/Wed/Fri one is at least four active
 * days, and never more than seven.
 */
export function activeDaysPerWeek(trajectory: Momentum['trajectory']): number {
  const weekdays = new Set<number>()
  let maxQuota = 0
  for (const h of trajectory) {
    if (h.paused) continue
    if (h.scheduleType === 'weekly') {
      maxQuota = Math.max(maxQuota, h.timesPerWeek ?? 0)
      continue
    }
    try {
      const days = JSON.parse(h.scheduleDays)
      if (Array.isArray(days)) for (const d of days) weekdays.add(Number(d))
    } catch {
      // A malformed scheduleDays shouldn't take the whole curve down.
    }
  }
  return Math.min(7, Math.max(weekdays.size, maxQuota))
}

export interface ProjectedPoint {
  weekOffset: number
  value: number
}

/** Project the curve forward. Fractional days are intentional — it's a trend line. */
export function project(from: number, perWeek: number, weeks: number): ProjectedPoint[] {
  const points: ProjectedPoint[] = []
  for (let w = 0; w <= weeks; w++) {
    points.push({ weekOffset: w, value: multiplier(from + perWeek * w) })
  }
  return points
}

export interface Projection {
  current: number
  atCurrentPace: ProjectedPoint[]
  atOneMoreDay: ProjectedPoint[]
  paceEnd: number
  oneMoreEnd: number
  activeDaysPerWeek: number
}

const PROJECTION_WEEKS = 52

/**
 * The two forward lines. When rhythm is 0 the pace line goes flat and the "one
 * more day a week" line does all the talking — which is exactly the moment that
 * message matters most, so it's never hidden.
 */
export function projectFan(
  progressDays: number,
  rhythmPct: number,
  weeklyActive: number,
  weeks = PROJECTION_WEEKS
): Projection {
  const pacePerWeek = weeklyActive > 0 ? (rhythmPct / 100) * weeklyActive : 0
  // You can't show up more often than you have days scheduled.
  const oneMorePerWeek = weeklyActive > 0 ? Math.min(pacePerWeek + 1, weeklyActive) : 0

  const atCurrentPace = project(progressDays, pacePerWeek, weeks)
  const atOneMoreDay = project(progressDays, oneMorePerWeek, weeks)

  return {
    current: multiplier(progressDays),
    atCurrentPace,
    atOneMoreDay,
    paceEnd: atCurrentPace[atCurrentPace.length - 1].value,
    oneMoreEnd: atOneMoreDay[atOneMoreDay.length - 1].value,
    activeDaysPerWeek: weeklyActive,
  }
}

/**
 * Multipliers span orders of magnitude, so one format rule reads badly at both
 * ends. Keep a decimal while it still means something, then drop it.
 */
export function formatMultiplier(value: number): string {
  if (value < 10) return `${value.toFixed(1)}×`
  if (value < 1000) return `${Math.round(value)}×`
  if (value < 1_000_000) return `${Math.round(value / 1000)}k×`
  return `${(value / 1_000_000).toFixed(1)}M×`
}
