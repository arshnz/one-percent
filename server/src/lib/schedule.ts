// The one place a habit's schedule is interpreted.
//
// Two modes:
//   'days'   — fixed weekdays. "Is it due?" is weekday membership, as it always was.
//   'weekly' — a quota of N reps on ANY days, Mon–Sun. "Gym 3× a week."
//
// A weekly quota is resolved into the SAME per-day `scheduled` booleans the rest
// of the app already consumes (week strip, contribution grid, compound curve,
// check-in summary), so nothing downstream needs a second schedule concept.
//
// The resolution rule — assign the shortfall to the TAIL of the week:
//
//   1. Eligible days = the Mon–Sun dates the habit existed and wasn't paused.
//   2. Effective quota = min(timesPerWeek, eligibleDays) — a habit created on
//      Saturday doesn't owe three sessions for that week.
//   3. Every day with a successful log is scheduled: it counted.
//   4. remaining = quota − hits. Walk the non-hit eligible days BACKWARDS from
//      Sunday and mark `remaining` of them. Everything else is a rest day.
//
// So nothing turns red while you still have slack, "today is a must" falls out
// as `remaining >= daysLeft`, and a week that ends short shows exactly the
// shortfall in red — on the days you ran out of runway, not on days you were
// never obliged to show up.

import { localDate } from './time.js'

export type Schedule =
  | { type: 'days'; days: number[] }
  | { type: 'weekly'; quota: number }

const ALL_DAYS = [0, 1, 2, 3, 4, 5, 6]

/** Habit fields this module reads. Kept structural so callers can pass rows or DTOs. */
export interface ScheduleFields {
  scheduleType?: string | null
  scheduleDays?: string | null
  timesPerWeek?: number | null
}

export function parseSchedule(h: ScheduleFields): Schedule {
  if (h.scheduleType === 'weekly') {
    const q = Number(h.timesPerWeek)
    // A corrupt or missing quota falls back to daily rather than taking the
    // whole momentum pipeline down.
    if (Number.isFinite(q) && q >= 1 && q <= 7) return { type: 'weekly', quota: Math.floor(q) }
    return { type: 'days', days: ALL_DAYS }
  }
  let days = ALL_DAYS
  if (h.scheduleDays) {
    try {
      const parsed = JSON.parse(h.scheduleDays)
      if (Array.isArray(parsed) && parsed.length) days = parsed.map(Number).filter((d) => d >= 0 && d <= 6)
    } catch {
      // Malformed scheduleDays reads as every day — the pre-existing behaviour.
    }
  }
  return { type: 'days', days: days.length ? days : ALL_DAYS }
}

export interface ResolvedDay {
  date: string
  weekday: number
  /** True when this day asks something of the habit — the flag the whole app reads. */
  scheduled: boolean
}

/** Bounds outside which a habit can't be scheduled at all. */
export interface ScheduleBounds {
  /** Local YYYY-MM-DD the habit was created. */
  createdOn: string
  /** Local YYYY-MM-DD of a pause — that day and after are rest. */
  pausedOn?: string | null
  /** Local YYYY-MM-DD of an archive — that day and after are rest. */
  archivedOn?: string | null
}

// One weekday derivation for the whole app. Noon-local construction sidesteps
// both DST edges and the UTC-vs-local drift the old call sites disagreed on.
export function weekdayOf(dateISO: string): number {
  return new Date(`${dateISO}T12:00:00`).getDay()
}

function eligible(date: string, b: ScheduleBounds): boolean {
  if (date < b.createdOn) return false
  if (b.pausedOn && date >= b.pausedOn) return false
  if (b.archivedOn && date >= b.archivedOn) return false
  return true
}

/**
 * Materialize one Mon–Sun week into per-day `scheduled` flags.
 *
 * `weekDates` must be the seven dates of a single week, Monday first — use
 * `weekDatesOf`. `hitDates` holds every date with a successful log (target or
 * fail-safe); misses and unlogged days are both simply absent from it.
 */
export function resolveWeek(
  sched: Schedule,
  weekDates: string[],
  hitDates: Set<string>,
  bounds: ScheduleBounds
): ResolvedDay[] {
  if (sched.type === 'days') {
    return weekDates.map((date) => {
      const weekday = weekdayOf(date)
      return { date, weekday, scheduled: eligible(date, bounds) && sched.days.includes(weekday) }
    })
  }

  const live = weekDates.filter((d) => eligible(d, bounds))
  // Prorate: you can't owe reps for days the habit didn't exist for.
  const quota = Math.min(sched.quota, live.length)
  const hits = live.filter((d) => hitDates.has(d))
  const marked = new Set(hits)

  // Reserve the shortfall against the LAST unhit days of the week. Do it from
  // Sunday backwards so the obligation lands as late as it honestly can — that
  // is what keeps earlier days from reading as misses you never owed.
  let remaining = quota - hits.length
  for (let i = live.length - 1; i >= 0 && remaining > 0; i--) {
    const d = live[i]
    if (marked.has(d)) continue
    marked.add(d)
    remaining--
  }

  return weekDates.map((date) => ({ date, weekday: weekdayOf(date), scheduled: marked.has(date) }))
}

/** The seven dates (Monday first) of the week containing `dateISO`. */
export function weekDatesOf(dateISO: string): string[] {
  const base = new Date(`${dateISO}T12:00:00`)
  base.setDate(base.getDate() - ((base.getDay() + 6) % 7)) // back to Monday
  const out: string[] = []
  for (let i = 0; i < 7; i++) {
    out.push(isoOf(base))
    base.setDate(base.getDate() + 1)
  }
  return out
}

function isoOf(d: Date): string {
  const y = d.getFullYear()
  const m = String(d.getMonth() + 1).padStart(2, '0')
  const day = String(d.getDate()).padStart(2, '0')
  return `${y}-${m}-${day}`
}

/**
 * Resolve an arbitrary inclusive date range by slicing it into Mon–Sun weeks.
 * Weekly quotas only make sense a whole week at a time, so partial weeks at
 * either end are resolved in full and then trimmed to the range.
 */
export function resolveRange(
  sched: Schedule,
  fromISO: string,
  toISO: string,
  hitDates: Set<string>,
  bounds: ScheduleBounds
): ResolvedDay[] {
  if (toISO < fromISO) return []
  const out: ResolvedDay[] = []
  let week = weekDatesOf(fromISO)
  // A year of cells is ~53 weeks; the cap is a runaway guard, not a limit.
  for (let guard = 0; guard < 600; guard++) {
    for (const day of resolveWeek(sched, week, hitDates, bounds)) {
      if (day.date >= fromISO && day.date <= toISO) out.push(day)
    }
    if (week[6] >= toISO) break
    week = weekDatesOf(shiftDays(week[6], 1))
  }
  return out
}

export function shiftDays(dateISO: string, n: number): string {
  const d = new Date(`${dateISO}T12:00:00`)
  d.setDate(d.getDate() + n)
  return isoOf(d)
}

export interface WeekProgress {
  quota: number
  hits: number
  remaining: number
  /** Days left in the Mon–Sun week, today included. */
  daysLeft: number
  /** remaining >= daysLeft — the buffer is gone, today is a must. */
  obligatedToday: boolean
}

/**
 * Week-to-date state of a weekly habit. Null for fixed-day habits — they have no
 * quota to be part-way through. Drives the card copy and the reminder gate.
 */
export function weekProgress(
  sched: Schedule,
  todayISO: string,
  hitDates: Set<string>,
  bounds: ScheduleBounds
): WeekProgress | null {
  if (sched.type !== 'weekly') return null
  const week = weekDatesOf(todayISO)
  const live = week.filter((d) => eligible(d, bounds))
  const quota = Math.min(sched.quota, live.length)
  const hits = live.filter((d) => hitDates.has(d)).length
  const remaining = Math.max(0, quota - hits)
  const daysLeft = live.filter((d) => d >= todayISO).length
  return {
    quota,
    hits,
    remaining,
    daysLeft,
    // Equivalent to "today is in the reserved tail" — kept as the arithmetic so
    // reminders can read it without materializing a week.
    obligatedToday: remaining > 0 && daysLeft > 0 && remaining >= daysLeft,
  }
}

/**
 * Is this habit due today? The single replacement for the old
 * `JSON.parse(scheduleDays).includes(weekday)` scattered across the app.
 */
export function isDueOn(
  sched: Schedule,
  dateISO: string,
  hitDates: Set<string>,
  bounds: ScheduleBounds
): boolean {
  const week = resolveWeek(sched, weekDatesOf(dateISO), hitDates, bounds)
  return week.find((d) => d.date === dateISO)?.scheduled ?? false
}

/** Convenience: local bounds for a habit row, in the user's timezone. */
export function boundsOf(
  h: { createdAt: Date; pausedAt?: Date | null; archivedAt?: Date | null },
  tz: string
): ScheduleBounds {
  return {
    createdOn: localDate(h.createdAt, tz),
    pausedOn: h.pausedAt ? localDate(h.pausedAt, tz) : null,
    archivedOn: h.archivedAt ? localDate(h.archivedAt, tz) : null,
  }
}
