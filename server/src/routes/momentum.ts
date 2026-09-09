import { Router } from 'express'
import { prisma } from '../lib/prisma.js'
import { requireAuth, AuthRequest } from '../middleware/auth.js'
import { assertWorkstation } from '../lib/workstation.js'
import {
  parseSchedule, resolveRange, weekdayOf,
  type Schedule, type ScheduleBounds,
} from '../lib/schedule.js'

const minISO = (a: string, b: string) => (a < b ? a : b)

const router = Router({ mergeParams: true })
router.use(requireAuth)

const WEEKDAYS_MS = 24 * 60 * 60 * 1000

function parseInsights(s: string): string[] {
  try {
    const parsed = JSON.parse(s)
    return Array.isArray(parsed) ? parsed.filter((x) => typeof x === 'string') : []
  } catch {
    return []
  }
}

function localDate(d: Date, timezone: string): string {
  try {
    return new Intl.DateTimeFormat('en-CA', { timeZone: timezone }).format(d)
  } catch {
    return new Intl.DateTimeFormat('en-CA').format(d)
  }
}

// Time of day as a 0–1 fraction in the user's timezone.
function localHourFraction(d: Date, timezone: string): number {
  try {
    const parts = new Intl.DateTimeFormat('en-GB', {
      timeZone: timezone, hour: '2-digit', minute: '2-digit', hour12: false,
    }).formatToParts(d)
    const h = Number(parts.find((p) => p.type === 'hour')?.value ?? 0) % 24
    const m = Number(parts.find((p) => p.type === 'minute')?.value ?? 0)
    return (h + m / 60) / 24
  } catch {
    return (d.getHours() + d.getMinutes() / 60) / 24
  }
}

// Rhythm (0–100): recency-weighted adherence to scheduled days. EWMA-style —
// recent days count more (half-life 14 days). Bends down gently on a miss.
const RHYTHM_HALFLIFE = 14
const RHYTHM_LOOKBACK = 60
// `scheduledOn` is the materialized schedule (see lib/schedule.ts) — it already
// excludes days before creation, days on/after a pause, and, for a weekly quota,
// days the habit had slack on. Resting isn't missing, and neither is a day you
// were never obliged to show up.
function rhythmScore(
  scheduledOn: Map<string, boolean>, hitDates: Set<string>, tz: string, now: number
): number {
  let wsum = 0, hit = 0
  for (let i = 0; i < RHYTHM_LOOKBACK; i++) {
    const ds = localDate(new Date(now - i * WEEKDAYS_MS), tz)
    if (!scheduledOn.get(ds)) continue
    const w = Math.pow(0.5, i / RHYTHM_HALFLIFE)
    wsum += w
    if (hitDates.has(ds)) hit += w
  }
  return wsum > 0 ? Math.round((hit / wsum) * 100) : 0
}

// Anchoring (0–100): how tightly reps cluster at the same time of day.
// Mean resultant length of the circular distribution (handles midnight wrap).
// Null until we have ≥ 3 reps to judge.
function anchoringScore(fractions: number[]): number | null {
  if (fractions.length < 3) return null
  let sx = 0, sy = 0
  for (const f of fractions) {
    const a = f * 2 * Math.PI
    sx += Math.cos(a)
    sy += Math.sin(a)
  }
  const R = Math.sqrt(sx * sx + sy * sy) / fractions.length
  return Math.round(R * 100)
}

// A minimal day-by-day grid (date / count / scheduled) spanning [startISO, endISO]
// inclusive. Enough for the compound curve, which only reads those three fields.
// Used for archived habits — the full per-habit grid (statuses, saved misses) is
// display-only and archived habits aren't displayed.
function scheduleGrid(
  sched: Schedule, startISO: string, endISO: string, hitDates: Set<string>, bounds: ScheduleBounds
) {
  return resolveRange(sched, startISO, endISO, hitDates, bounds).map((d) => ({
    date: d.date,
    count: hitDates.has(d.date) ? 1 : 0,
    scheduled: d.scheduled,
  }))
}

// GET / — Momentum aggregates. No streaks, ever.
router.get('/', async (req: AuthRequest, res, next) => {
  try {
    const wsId = req.params.wsId as string
    const ws = await assertWorkstation(wsId, req.userId!)
    const tz = req.userTimezone ?? 'Pacific/Auckland'

    const habits = await prisma.habit.findMany({
      where: { workstationId: wsId, archivedAt: null },
      include: { phases: { orderBy: { phaseNumber: 'asc' } } },
    })
    const habitIds = habits.map((h) => h.id)

    const logs = habitIds.length
      ? await prisma.habitLog.findMany({
          where: { habitId: { in: habitIds } },
          select: { date: true, status: true, habitId: true, createdAt: true, missReasons: true },
        })
      : []

    // 1. Total Identity Votes — lifetime successful reps (target OR fail-safe).
    const successLogs = logs.filter((l) => l.status === 'target' || l.status === 'failsafe')
    const totalVotes = successLogs.length

    // 2. Democratic Vote Ratio over a trailing 30-day window.
    // Denominator = scheduled occurrences in the window (a "miss" is simply a
    // scheduled day with no successful log — forward-compatible with the future
    // Midnight Sweep auto-logger).
    const WINDOW = 30
    const today = new Date()
    const windowDates: string[] = []
    for (let i = 0; i < WINDOW; i++) {
      windowDates.push(localDate(new Date(today.getTime() - i * WEEKDAYS_MS), tz))
    }
    const windowSet = new Set(windowDates)

    // Accumulated in the per-habit loop below, where each habit's schedule is
    // already materialized — a weekly quota's "expected" is the reps it owed,
    // not the days of the week it happens to fall on.
    let expected = 0
    const windowSuccesses = successLogs.filter((l) => windowSet.has(l.date)).length

    const GRID_DAYS = 365 // A full year of cells — the client slices this down per the selected range (7d/30d/6m/1y).
    const counts = new Map<string, number>()
    for (const l of successLogs) counts.set(l.date, (counts.get(l.date) ?? 0) + 1)
    const contributions: { date: string; count: number }[] = []
    for (let i = GRID_DAYS - 1; i >= 0; i--) {
      const ds = localDate(new Date(today.getTime() - i * WEEKDAYS_MS), tz)
      contributions.push({ date: ds, count: counts.get(ds) ?? 0 })
    }

    // 4. Consistency = Rhythm + Anchoring, per habit and overall.
    // (Habit strength tracks cue regularity, not raw rep volume.)
    const now = today.getTime()
    const perHabitConsistency = new Map<string, { rhythm: number; anchoring: number | null; consistency: number }>()
    // Each habit gets its own contribution grid (one vote/day max → 0 or 1).
    const perHabitContrib = new Map<string, { date: string; count: number; wasSavedMiss?: boolean }[]>()

    // "What gets in the way" — recorded miss reasons, counted per habit (90d)
    // and across the workspace (30d).
    const day90 = localDate(new Date(now - 90 * WEEKDAYS_MS), tz)
    const day30 = localDate(new Date(now - 30 * WEEKDAYS_MS), tz)
    const parseReasons = (s: string): string[] => { try { const r = JSON.parse(s); return Array.isArray(r) ? r : [] } catch { return [] } }
    const countTop = (counts: Map<string, number>, top: number) =>
      [...counts.entries()].sort((a, b) => b[1] - a[1]).slice(0, top).map(([reason, count]) => ({ reason, count }))
    const perHabitObstacles = new Map<string, { reason: string; count: number }[]>()
    const perHabitMissPattern = new Map<string, string | null>()
    const perHabitReasonByDate = new Map<string, Map<string, string[]>>()
    const workspaceCounts = new Map<string, number>()
    for (const l of logs) {
      if (l.status !== 'miss') continue
      const reasons = parseReasons(l.missReasons)
      if (!reasons.length) continue
      let byDate = perHabitReasonByDate.get(l.habitId)
      if (!byDate) { byDate = new Map(); perHabitReasonByDate.set(l.habitId, byDate) }
      byDate.set(l.date, reasons)
      if (l.date >= day30) for (const r of reasons) workspaceCounts.set(r, (workspaceCounts.get(r) ?? 0) + 1)
    }

    let totalRecoveries = 0

    const endStr = localDate(today, tz)
    for (const h of habits) {
      const sched = parseSchedule(h)
      const created = localDate(new Date(h.createdAt), tz)
      const habitSuccess = successLogs.filter((l) => l.habitId === h.id)
      const hitDates = new Set(habitSuccess.map((l) => l.date))
      const hitMap = new Map<string, string>()
      for (const l of habitSuccess) hitMap.set(l.date, l.status)

      const pausedISO = h.pausedAt ? localDate(new Date(h.pausedAt), tz) : null
      const bounds: ScheduleBounds = { createdOn: created, pausedOn: pausedISO }

      // Materialize the whole displayed span once — rhythm, saved misses, the
      // miss pattern and the contribution grid all read the same resolution, so
      // they can't disagree about which days the habit actually asked for.
      const gridStart = minISO(created, localDate(new Date(now - (GRID_DAYS - 1) * WEEKDAYS_MS), tz))
      const resolved = resolveRange(sched, gridStart, endStr, hitDates, bounds)
      const scheduledOn = new Map(resolved.map((d) => [d.date, d.scheduled]))

      for (const ds of windowDates) if (scheduledOn.get(ds)) expected++

      const rhythm = rhythmScore(scheduledOn, hitDates, tz, now)
      const anchoring = anchoringScore(habitSuccess.map((l) => localHourFraction(new Date(l.createdAt), tz)))
      const consistency = anchoring === null
        ? rhythm
        : Math.round(0.6 * rhythm + 0.4 * anchoring)
      perHabitConsistency.set(h.id, { rhythm, anchoring, consistency })

      // Identify saved misses — a scheduled day you skipped but came back to on
      // the very next one you owed.
      const allScheduledDates = resolved.filter((d) => d.scheduled).map((d) => d.date)

      const savedMisses = new Set<string>()
      for (let i = 0; i < allScheduledDates.length - 1; i++) {
        const curr = allScheduledDates[i]
        const next = allScheduledDates[i + 1]
        if (!hitDates.has(curr) && hitDates.has(next)) {
          savedMisses.add(curr)
          totalRecoveries++
        }
      }

      // Top obstacles (90d) from recorded reasons on this habit's miss days.
      const reasonByDate = perHabitReasonByDate.get(h.id) ?? new Map<string, string[]>()
      const obstacleCounts = new Map<string, number>()
      for (const [ds, reasons] of reasonByDate) {
        if (ds < day90) continue
        for (const r of reasons) obstacleCounts.set(r, (obstacleCounts.get(r) ?? 0) + 1)
      }
      perHabitObstacles.set(h.id, countTop(obstacleCounts, 4))

      // Miss pattern (90d): if one weekday carries at least half of the misses
      // (min 3), name it. A miss here = a scheduled day with no successful log.
      //
      // Skipped for weekly-quota habits: their obligations are reserved against
      // the tail of the week, so the histogram would always "discover" Sunday.
      // That's an artefact of the resolver, not a fact about the person.
      const missWeekdays = new Map<number, number>()
      let missTotal = 0
      if (sched.type === 'days') {
        for (const ds of allScheduledDates) {
          if (ds < day90 || ds >= endStr) continue // today can still be logged
          if (hitDates.has(ds)) continue
          const wd = weekdayOf(ds)
          missWeekdays.set(wd, (missWeekdays.get(wd) ?? 0) + 1)
          missTotal++
        }
      }
      let missPattern: string | null = null
      if (missTotal >= 3) {
        const [topWd, topCount] = [...missWeekdays.entries()].sort((a, b) => b[1] - a[1])[0]
        if (topCount / missTotal >= 0.5) {
          const names = ['Sundays', 'Mondays', 'Tuesdays', 'Wednesdays', 'Thursdays', 'Fridays', 'Saturdays']
          missPattern = `Most misses land on ${names[topWd]}.`
        }
      }
      perHabitMissPattern.set(h.id, missPattern)

      // The displayed grid — same span and same resolution as everything above.
      const grid = resolved.map((d) => ({
        date: d.date,
        count: hitDates.has(d.date) ? 1 : 0,
        wasSavedMiss: savedMisses.has(d.date),
        status: hitMap.get(d.date),
        scheduled: d.scheduled,
        ...(reasonByDate.has(d.date) ? { missReasons: reasonByDate.get(d.date) } : {}),
      }))
      perHabitContrib.set(h.id, grid as any)
    }
    const ratioPct = expected > 0 ? Math.round((Math.min(windowSuccesses, expected) / expected) * 100) : 0

    // Paused habits are resting — leave them out of the headline average so a
    // deliberate break doesn't read as a slump.
    const consistencyValues = habits
      .filter((h) => !h.pausedAt)
      .map((h) => perHabitConsistency.get(h.id))
      .filter((c): c is { rhythm: number; anchoring: number | null; consistency: number } => !!c)
    const overall = consistencyValues.length
      ? {
          consistency: Math.round(consistencyValues.reduce((a, c) => a + c.consistency, 0) / consistencyValues.length),
          rhythm: Math.round(consistencyValues.reduce((a, c) => a + c.rhythm, 0) / consistencyValues.length),
          anchoring: (() => {
            const withAnchor = consistencyValues.filter((c) => c.anchoring !== null)
            return withAnchor.length
              ? Math.round(withAnchor.reduce((a, c) => a + (c.anchoring as number), 0) / withAnchor.length)
              : null
          })(),
        }
      : { consistency: 0, rhythm: 0, anchoring: null }

    // 5. Phase-climb trajectory — how the user has progressed through phases.
    const trajectory = habits.map((h) => ({
      habitId: h.id,
      title: h.title,
      kind: h.kind,
      breakMode: h.breakMode,
      paused: !!h.pausedAt,
      // The compound curve's "ceiling" line needs these: pausedAt so rest days
      // don't count as slots you could have hit, and the schedule to project how
      // many days a week can move the curve at all. Same rule rhythmScore follows.
      pausedAt: h.pausedAt,
      scheduleType: h.scheduleType,
      scheduleDays: h.scheduleDays,
      timesPerWeek: h.timesPerWeek,
      // The per-habit grid spans a fixed year; createdAt lets the curve ignore
      // scheduled days before the habit existed (a day you couldn't have shown
      // up on isn't a day you missed).
      createdAt: h.createdAt,
      consistency: perHabitConsistency.get(h.id) ?? { rhythm: 0, anchoring: null, consistency: 0 },
      contributions: perHabitContrib.get(h.id) ?? [],
      topObstacles: perHabitObstacles.get(h.id) ?? [],
      missPattern: perHabitMissPattern.get(h.id) ?? null,
      setbackObstacles: ((): string[] => {
        try {
          const plans = JSON.parse(h.setbackPlans) as { obstacle?: string }[]
          return plans.map((p) => p.obstacle ?? '').filter(Boolean)
        } catch { return [] }
      })(),
      phases: h.phases.map((p) => ({
        phaseNumber: p.phaseNumber,
        targetText: p.targetText,
        targetCount: p.targetCount,
        status: p.status,
        graduatedAt: p.graduatedAt,
      })),
    }))

    // 6. The two series we actually *measure* (as opposed to the compound curve,
    // which is a picture of the vote count). Both are sparse by nature — an
    // automaticity check only fires when a phase hits 'ready', and a rating only
    // exists if the user filled in that week's check-in.
    const automaticity = habitIds.length
      ? await prisma.automaticityCheck.findMany({
          where: { habitId: { in: habitIds } },
          select: { habitId: true, mean: true, passed: true, createdAt: true },
          orderBy: { createdAt: 'asc' },
        })
      : []

    // desc + take + reverse — asc + take would return the OLDEST 26 weeks.
    const weeklyRatings = (
      await prisma.checkIn.findMany({
        where: { workstationId: wsId, rating: { not: null } },
        select: { weekOf: true, rating: true },
        orderBy: { weekOf: 'desc' },
        take: 26,
      })
    ).reverse()

    // 7. Archived (deleted/retired) habits — every rep is a permanent vote, so
    // their earned history stays in the compound curve, frozen at the archive
    // date. Deliberately excluded from everything else: they're not cards, not
    // in any current-state metric (rhythm, obstacles, votes), not in the
    // projection. Only the curve remembers them.
    const archivedHabits = await prisma.habit.findMany({
      where: { workstationId: wsId, archivedAt: { not: null } },
    })
    const archivedIds = archivedHabits.map((h) => h.id)
    const archivedHits = archivedIds.length
      ? await prisma.habitLog.findMany({
          where: { habitId: { in: archivedIds }, status: { in: ['target', 'failsafe'] } },
          select: { date: true, habitId: true },
        })
      : []
    const archived = archivedHabits.map((h) => {
      const created = localDate(new Date(h.createdAt), tz)
      const archivedOn = localDate(new Date(h.archivedAt as Date), tz)
      const pausedOn = h.pausedAt ? localDate(new Date(h.pausedAt), tz) : null
      const hitDates = new Set(archivedHits.filter((l) => l.habitId === h.id).map((l) => l.date))
      return {
        contributions: scheduleGrid(parseSchedule(h), created, archivedOn, hitDates, {
          createdOn: created, pausedOn, archivedOn,
        }),
        createdAt: h.createdAt,
        pausedAt: h.pausedAt,
        archivedAt: h.archivedAt,
      }
    })

    res.json({
      totalVotes,
      totalRecoveries,
      consistency: overall,
      automaticity,
      weeklyRatings,
      ratio: { successes: windowSuccesses, expected, pct: ratioPct, windowDays: WINDOW },
      contributions,
      trajectory,
      archived,
      habitCount: habits.length,
      topObstacle: countTop(workspaceCounts, 1)[0] ?? null,
      // Cached natural-language insights (regenerated by POST /ai/insights
      // after each check-in save) — this route never calls the AI itself.
      insights: ws.momentumInsights
        ? { items: parseInsights(ws.momentumInsights), generatedAt: ws.momentumInsightsAt }
        : null,
    })
  } catch (err) {
    next(err)
  }
})

export default router
