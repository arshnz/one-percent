import { Router } from 'express'
import { z } from 'zod'
import { prisma } from '../lib/prisma.js'
import { requireAuth, AuthRequest } from '../middleware/auth.js'
import { assertWorkstation } from '../lib/workstation.js'
import { localWeekStartMonday, lastNDates, localDate } from '../lib/time.js'
import { parseSchedule, resolveRange, weekDatesOf, weekdayOf } from '../lib/schedule.js'
import { hasMissExplanation } from '../lib/miss.js'

const router = Router({ mergeParams: true })
router.use(requireAuth)

const WEEKDAY_NAMES = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday']

function safeParse<T>(s: string, fallback: T): T {
  try { return JSON.parse(s) as T } catch { return fallback }
}

// GET / — the check-in history (most recent first).
router.get('/', async (req: AuthRequest, res, next) => {
  try {
    const wsId = req.params.wsId as string
    await assertWorkstation(wsId, req.userId!)
    const checkIns = await prisma.checkIn.findMany({
      where: { workstationId: wsId },
      orderBy: { weekOf: 'desc' },
      take: 20,
    })
    res.json({ checkIns })
  } catch (err) {
    next(err)
  }
})

// GET /current — this week's data pack: the review target plus the real
// per-habit week so the AI companion (and the UI) can speak to actual behaviour.
router.get('/current', async (req: AuthRequest, res, next) => {
  try {
    const wsId = req.params.wsId as string
    await assertWorkstation(wsId, req.userId!)
    const tz = req.userTimezone ?? 'Pacific/Auckland'
    const now = new Date()
    const weekOf = localWeekStartMonday(now, tz)
    const week = lastNDates(now, tz, 7)
    // A weekly quota resolves a whole Mon–Sun week at a time, and the rolling
    // 7-day review window straddles two of them — so pull logs from the earlier
    // week's Monday, not just the window itself.
    const logsFrom = weekDatesOf(week[0])[0]

    const [existing, habits, logs, goals, priorCheckin] = await Promise.all([
      prisma.checkIn.findUnique({ where: { workstationId_weekOf: { workstationId: wsId, weekOf } } }),
      prisma.habit.findMany({
        where: { workstationId: wsId, archivedAt: null, pausedAt: null },
        include: { goal: { select: { title: true } } },
        orderBy: { createdAt: 'asc' },
      }),
      prisma.habitLog.findMany({
        where: { habit: { workstationId: wsId }, date: { gte: logsFrom, lte: week[6] } },
      }),
      prisma.goal.findMany({ where: { workstationId: wsId, status: 'active' }, select: { title: true } }),
      prisma.checkIn.findFirst({
        where: { workstationId: wsId, weekOf: { lt: weekOf } },
        orderBy: { weekOf: 'desc' },
      }),
    ])

    // Per-habit week summary: which of the 7 days were scheduled, hit, or missed.
    // Alongside it, collect the misses that still have no "what got in the way"
    // recorded — the check-in offers to fill those in as a batch.
    const today = localDate(now, tz)
    const logByHabitDate = new Map(logs.map((l) => [`${l.habitId}|${l.date}`, l]))
    const hitsByHabit = new Map<string, Set<string>>()
    for (const l of logs) {
      if (l.status === 'miss') continue
      let s = hitsByHabit.get(l.habitId)
      if (!s) { s = new Set(); hitsByHabit.set(l.habitId, s) }
      s.add(l.date)
    }
    const unexplainedMisses: Array<{
      habitId: string; habitTitle: string; date: string; weekdayName: string; obstacles: string[]
    }> = []
    const summary = habits.map((h) => {
      const sched = parseSchedule(h)
      const createdLocal = localDate(h.createdAt, tz)
      const bounds = { createdOn: createdLocal, pausedOn: h.pausedAt ? localDate(h.pausedAt, tz) : null }
      const planObstacles = safeParse<{ obstacle: string; plan: string }[]>(h.setbackPlans, [])
        .map((p) => p.obstacle).filter(Boolean)
      // For a weekly quota, "scheduled" is the reps the week owed and the red
      // dots are the days the buffer ran out on — the resolver decides which,
      // exactly as the week strip shows them. resolveRange slices the rolling
      // window into calendar weeks so each quota is judged against its own.
      const hitDates = hitsByHabit.get(h.id) ?? new Set<string>()
      const scheduledOn = new Map(
        resolveRange(sched, week[0], week[6], hitDates, bounds).map((d) => [d.date, d.scheduled])
      )
      let hits = 0
      let scheduled = 0
      const redDots: string[] = []
      for (const date of week) {
        const wd = weekdayOf(date)
        if (!scheduledOn.get(date)) continue
        scheduled++
        const log = logByHabitDate.get(`${h.id}|${date}`)
        if (log && log.status !== 'miss') { hits++; continue }
        redDots.push(WEEKDAY_NAMES[wd])
        // Unexplained = a missed scheduled day (after the habit existed, not
        // today — today can still be logged) with no reasons recorded yet.
        // Chips OR a free-text note both count as an explanation.
        const explained = !!log && hasMissExplanation(log.missReasons, log.missNote)
        if (date !== today && date >= createdLocal && !explained) {
          unexplainedMisses.push({
            habitId: h.id, habitTitle: h.title, date, weekdayName: WEEKDAY_NAMES[wd], obstacles: planObstacles,
          })
        }
      }
      // scheduleType lets the client name the denominator: days for a fixed
      // schedule, sessions for a quota that could have landed anywhere.
      return { title: h.title, goalTitle: h.goal?.title ?? null, scheduleType: sched.type, scheduled, hits, redDots }
    })

    res.json({
      weekOf,
      existing,
      summary,
      unexplainedMisses,
      goals: goals.map((g) => g.title),
      priorObstacles: priorCheckin ? safeParse<{ obstacle: string; plan: string }[]>(priorCheckin.obstacles, []) : [],
    })
  } catch (err) {
    next(err)
  }
})

const ObstacleInput = z.array(
  z.object({
    obstacle: z.string().trim().min(1).max(300),
    plan: z.string().trim().min(1).max(300),
  })
).max(5)

const UpsertSchema = z.object({
  weekOf: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
  rating: z.number().int().min(1).max(10).nullable().optional(),
  tinyVictory: z.string().trim().max(1000).nullable().optional(),
  workingWell: z.string().trim().max(2000).nullable().optional(),
  notWorking: z.string().trim().max(2000).nullable().optional(),
  obstacles: ObstacleInput.optional(),
  freeform: z.string().trim().max(4000).nullable().optional(),
  aiSummary: z.string().trim().max(2000).nullable().optional(),
})

// POST / — upsert this week's check-in (one per week, keyed by weekOf).
router.post('/', async (req: AuthRequest, res, next) => {
  try {
    const wsId = req.params.wsId as string
    await assertWorkstation(wsId, req.userId!)
    const body = UpsertSchema.parse(req.body)
    const data = {
      rating: body.rating ?? null,
      tinyVictory: body.tinyVictory ?? null,
      workingWell: body.workingWell ?? null,
      notWorking: body.notWorking ?? null,
      obstacles: JSON.stringify(body.obstacles ?? []),
      freeform: body.freeform ?? null,
      aiSummary: body.aiSummary ?? null,
      // Saving a real check-in always counts as completed — including filling
      // in a week that was previously skipped.
      status: 'completed',
    }
    const checkIn = await prisma.checkIn.upsert({
      where: { workstationId_weekOf: { workstationId: wsId, weekOf: body.weekOf } },
      update: data,
      create: { workstationId: wsId, weekOf: body.weekOf, ...data },
    })
    res.json({ checkIn })
  } catch (err) {
    next(err)
  }
})

const SkipSchema = z.object({
  weekOf: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
})

// POST /skip — "not this week." Records a skipped row so the Launchpad card
// stays hidden until Monday and history shows the week honestly. Idempotent,
// and never downgrades a week that was already completed.
router.post('/skip', async (req: AuthRequest, res, next) => {
  try {
    const wsId = req.params.wsId as string
    await assertWorkstation(wsId, req.userId!)
    const { weekOf } = SkipSchema.parse(req.body)
    const existing = await prisma.checkIn.findUnique({
      where: { workstationId_weekOf: { workstationId: wsId, weekOf } },
    })
    if (existing) {
      res.json({ checkIn: existing })
      return
    }
    const checkIn = await prisma.checkIn.create({
      data: { workstationId: wsId, weekOf, status: 'skipped' },
    })
    res.json({ checkIn })
  } catch (err) {
    next(err)
  }
})

export default router
