import { Router } from 'express'
import { z } from 'zod'
import { prisma } from '../lib/prisma.js'
import { requireAuth, AuthRequest } from '../middleware/auth.js'
import { assertWorkstation } from '../lib/workstation.js'
import { hasMissExplanation } from '../lib/miss.js'
import {
  parseSchedule, resolveRange, weekProgress, weekDatesOf, shiftDays, boundsOf,
  type ResolvedDay,
} from '../lib/schedule.js'

const router = Router({ mergeParams: true })
router.use(requireAuth)

const WEEKDAYS = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat']

// Local date (YYYY-MM-DD) and weekday number (0=Sun..6=Sat) for a timezone.
function localToday(timezone: string) {
  const now = new Date()
  let date: string
  let weekday: number
  try {
    date = new Intl.DateTimeFormat('en-CA', { timeZone: timezone }).format(now)
    const wd = new Intl.DateTimeFormat('en-US', { timeZone: timezone, weekday: 'short' }).format(now)
    weekday = WEEKDAYS.indexOf(wd)
  } catch {
    date = new Intl.DateTimeFormat('en-CA').format(now)
    weekday = now.getDay()
  }
  return { date, weekday }
}

// The last `n` local dates (oldest → newest, today last) with their weekdays —
// each instant formatted in the user's timezone so DST shifts can't skew days.
function lastNLocalDays(timezone: string, n: number): { date: string; weekday: number }[] {
  const out: { date: string; weekday: number }[] = []
  for (let i = n - 1; i >= 0; i--) {
    const d = new Date(Date.now() - i * 86_400_000)
    try {
      out.push({
        date: new Intl.DateTimeFormat('en-CA', { timeZone: timezone }).format(d),
        weekday: WEEKDAYS.indexOf(new Intl.DateTimeFormat('en-US', { timeZone: timezone, weekday: 'short' }).format(d)),
      })
    } catch {
      out.push({ date: new Intl.DateTimeFormat('en-CA').format(d), weekday: d.getDay() })
    }
  }
  return out
}

function localDateInTz(instant: Date, timezone: string): string {
  try {
    return new Intl.DateTimeFormat('en-CA', { timeZone: timezone }).format(instant)
  } catch {
    return new Intl.DateTimeFormat('en-CA').format(instant)
  }
}

// Reps logged against a phase that count as completions (target OR fail-safe).
async function completedReps(phaseId: string): Promise<number> {
  return prisma.habitLog.count({
    where: { phaseId, status: { in: ['target', 'failsafe'] } },
  })
}

function activePhase<T extends { status: string; phaseNumber: number }>(phases: T[]): T | null {
  return (
    phases.find((p) => p.status === 'ready') ??
    phases.find((p) => p.status === 'active') ??
    [...phases].sort((a, b) => b.phaseNumber - a.phaseNumber)[0] ??
    null
  )
}

const REPROMPT_DAYS = 7

// Pure: derive eligibility/due-ness from an already-fetched latest check (or
// null if none). Shared by the batched /today path and automaticityState below.
function automaticityFromCheck(
  phase: { status: string } | null,
  last: { passed: boolean; createdAt: Date } | null
) {
  if (!phase || phase.status !== 'ready') return { eligible: false, due: false }
  let due = false
  if (!last) due = true
  else if (!last.passed) {
    due = (Date.now() - new Date(last.createdAt).getTime()) / 86_400_000 >= REPROMPT_DAYS
  }
  return { eligible: true, due }
}

// Whether the active phase is eligible for the Automaticity Check, and whether
// one is due now (never taken, or last one failed > 7 days ago).
async function automaticityState(phase: { id: string; status: string } | null) {
  if (!phase || phase.status !== 'ready') return { eligible: false, due: false }
  const last = await prisma.automaticityCheck.findFirst({
    where: { phaseId: phase.id },
    orderBy: { createdAt: 'desc' },
  })
  return automaticityFromCheck(phase, last)
}

const CueType = z.enum(['habit_stack', 'time', 'location'])
const HabitKind = z.enum(['build', 'break'])
const BreakMode = z.enum(['abstain', 'taper'])
const ScheduleType = z.enum(['days', 'weekly'])

// The core concreteness guardrail, enforced server-side so the rule holds
// regardless of the client. A build habit needs a concrete cue (routine/time/
// place — when to ACT). A break habit instead needs a named trigger to avoid
// (the cue we're making invisible).
function assertConcreteCue(c: {
  kind?: 'build' | 'break'
  cueType: 'habit_stack' | 'time' | 'location'
  anchorRoutine?: string | null
  cueTime?: string | null
  cueLocation?: string | null
  avoidTrigger?: string | null
}) {
  if (c.kind === 'break') {
    if (!c.avoidTrigger?.trim()) {
      throw Object.assign(new Error('Name the trigger you’re removing — the cue that sets the habit off.'), { status: 400 })
    }
    return
  }
  const ok =
    (c.cueType === 'habit_stack' && !!c.anchorRoutine?.trim()) ||
    (c.cueType === 'time' && !!c.cueTime?.trim()) ||
    (c.cueType === 'location' && !!c.cueLocation?.trim())
  if (!ok) {
    throw Object.assign(new Error('Give the cue a concrete trigger — a routine, a time, or a place.'), { status: 400 })
  }
}

// Workbook "Prepare for Setbacks": paired if/then rows kept small and concrete.
const SetbackPlanInput = z.array(
  z.object({
    obstacle: z.string().trim().min(1).max(300),
    plan: z.string().trim().min(1).max(300),
  })
).max(3)

// Free-text notes per worksheet section — the user's own tactics beyond the
// structured blocks. Every key optional; each capped so a note stays a note.
const SectionNotesInput = z.object({
  cue: z.string().trim().max(1000).optional(),
  craving: z.string().trim().max(1000).optional(),
  response: z.string().trim().max(1000).optional(),
  reward: z.string().trim().max(1000).optional(),
  setbacks: z.string().trim().max(1000).optional(),
}).strict()

const PhaseInput = z.object({
  targetText: z.string().trim().min(1).max(300),
  definitionOfDone: z.string().trim().max(300).optional().nullable(),
  targetCount: z.number().int().min(1).max(1000),
  dailyLimit: z.number().int().min(0).max(1000).optional().nullable(),
})

// A goalId must belong to the same workstation — enforced before writes so a
// habit can never point at another user's goal.
async function assertGoal(goalId: string, wsId: string) {
  const goal = await prisma.goal.findFirst({ where: { id: goalId, workstationId: wsId } })
  if (!goal) {
    throw Object.assign(new Error('Goal not found for this workstation.'), { status: 400 })
  }
}

const CreateSchema = z.object({
  kind: HabitKind.default('build'),
  goalId: z.string().trim().min(1).optional().nullable(),
  breakMode: BreakMode.optional().nullable(),
  avoidTrigger: z.string().trim().max(300).optional().nullable(),
  replacementAction: z.string().trim().max(300).optional().nullable(),
  frictionDevice: z.string().trim().max(300).optional().nullable(),
  checkStyle: z.enum(['hold', 'yesno']).optional(),
  checkQuestion: z.string().trim().max(200).optional().nullable(),
  title: z.string().trim().min(1).max(200),
  whyText: z.string().trim().max(2000).optional().nullable(),
  whyImageUrl: z.string().trim().max(2000).optional().nullable(),
  cueType: CueType.default('habit_stack'),
  anchorRoutine: z.string().trim().max(300).optional().nullable(),
  cueTime: z.string().trim().max(20).optional().nullable(),
  cueLocation: z.string().trim().max(200).optional().nullable(),
  failSafeAction: z.string().trim().min(1).max(300),
  celebration: z.string().trim().max(200).optional().nullable(),
  temptationBundle: z.string().trim().max(200).optional().nullable(),
  scheduleType: ScheduleType.optional(),
  scheduleDays: z.array(z.number().int().min(0).max(6)).min(1).optional(),
  timesPerWeek: z.number().int().min(1).max(6).optional().nullable(),
  reminderTime: z.string().trim().regex(/^\d{1,2}:\d{2}$/).max(5).optional().nullable(),
  reminderEnabled: z.boolean().optional(),
  nightstandRule: z.string().trim().max(500).optional().nullable(),
  setbackPlans: SetbackPlanInput.optional(),
  systemFocusConfirmed: z.boolean().optional(),
  sectionNotes: SectionNotesInput.optional(),
  // The pre-mapped phase ladder: index 0 is the active starting step, the rest
  // are locked steps that auto-unlock as each one graduates. `phase1` is kept as
  // a legacy single-step alias.
  phases: z.array(PhaseInput).min(1).max(6).optional(),
  phase1: PhaseInput.optional(),
}).refine((d) => (d.phases?.length ?? 0) > 0 || !!d.phase1, {
  message: 'At least one phase is required.',
}).refine((d) => d.scheduleType !== 'weekly' || !!d.timesPerWeek, {
  message: 'A weekly habit needs a number of times per week.',
  path: ['timesPerWeek'],
})

// POST / — create a habit with its permanent fail-safe + Phase 1 in one call.
router.post('/', async (req: AuthRequest, res, next) => {
  try {
    const wsId = req.params.wsId as string
    await assertWorkstation(wsId, req.userId!)
    const body = CreateSchema.parse(req.body)
    assertConcreteCue(body)

    // Cap of 6 active habits — six slots on the Launchpad. Archive one to add another.
    const activeCount = await prisma.habit.count({
      where: { workstationId: wsId, archivedAt: null },
    })
    if (activeCount >= 6) {
      const err = Object.assign(
        new Error('Six habits is the hard ceiling — and honestly, one at a time sticks best. Archive or pause one to start another.'),
        { status: 400 }
      )
      throw err
    }

    if (body.goalId) await assertGoal(body.goalId, wsId)

    // Taper habits log a daily count — a yes/no question can't carry one.
    if (body.checkStyle === 'yesno' && body.kind === 'break' && (body.breakMode ?? 'abstain') === 'taper') {
      res.status(400).json({ error: 'Taper habits use a daily count, not a yes/no question.' })
      return
    }

    // Normalise to the ladder: first step active, the rest locked.
    const ladder = body.phases?.length ? body.phases : body.phase1 ? [body.phase1] : []

    const habit = await prisma.habit.create({
      data: {
        workstationId: wsId,
        kind: body.kind,
        goalId: body.goalId ?? null,
        breakMode: body.kind === 'break' ? body.breakMode ?? 'abstain' : null,
        avoidTrigger: body.avoidTrigger ?? null,
        replacementAction: body.replacementAction ?? null,
        frictionDevice: body.frictionDevice ?? null,
        checkStyle: body.checkStyle ?? 'hold',
        checkQuestion: body.checkQuestion ?? null,
        title: body.title,
        whyText: body.whyText ?? null,
        whyImageUrl: body.whyImageUrl ?? null,
        cueType: body.cueType,
        anchorRoutine: body.anchorRoutine ?? null,
        cueTime: body.cueTime ?? null,
        cueLocation: body.cueLocation ?? null,
        failSafeAction: body.failSafeAction,
        celebration: body.celebration ?? null,
        temptationBundle: body.temptationBundle ?? null,
        scheduleType: body.scheduleType ?? 'days',
        scheduleDays: JSON.stringify(body.scheduleDays ?? [0, 1, 2, 3, 4, 5, 6]),
        timesPerWeek: body.scheduleType === 'weekly' ? body.timesPerWeek ?? null : null,
        reminderTime: body.reminderTime ?? null,
        reminderEnabled: body.reminderEnabled ?? true,
        nightstandRule: body.nightstandRule ?? null,
        setbackPlans: JSON.stringify(body.setbackPlans ?? []),
        systemFocusConfirmed: body.systemFocusConfirmed ?? false,
        sectionNotes: JSON.stringify(body.sectionNotes ?? {}),
        phases: {
          create: ladder.map((p, i) => ({
            phaseNumber: i + 1,
            targetText: p.targetText,
            definitionOfDone: p.definitionOfDone ?? null,
            targetCount: p.targetCount,
            dailyLimit: p.dailyLimit ?? null,
            status: i === 0 ? 'active' : 'locked',
          })),
        },
      },
      include: { phases: true, goal: { select: { id: true, title: true } } },
    })

    res.status(201).json({ habit })
  } catch (err) {
    next(err)
  }
})

// The most recent scheduled day before today — the never-miss-twice anchor.
// Reads the materialized schedule, so for a weekly habit it only ever points at
// a day the quota actually obliged: a day you had slack on was never a miss.
function previousScheduledDate(resolved: ResolvedDay[], today: string): string | null {
  for (let i = resolved.length - 1; i >= 0; i--) {
    const d = resolved[i]
    if (d.date >= today) continue
    if (d.scheduled) return d.date
  }
  return null
}

// GET /today — habits scheduled for the user's current weekday, with active
// phase, progress toward graduation, and today's log (if any).
router.get('/today', async (req: AuthRequest, res, next) => {
  try {
    const wsId = req.params.wsId as string
    await assertWorkstation(wsId, req.userId!)
    const tz = req.userTimezone ?? 'Pacific/Auckland'
    const { date, weekday } = localToday(tz)

    const habits = await prisma.habit.findMany({
      where: { workstationId: wsId, archivedAt: null, pausedAt: null },
      include: { phases: true, goal: { select: { id: true, title: true } } },
      orderBy: { createdAt: 'asc' },
    })

    // Resolving a weekly quota needs the week's logs in hand, so the log query
    // comes first now and the schedule is materialized from its results.
    const perHabit = habits.map((h) => ({ habit: h, phase: activePhase(h.phases) }))

    // The last 7 local days feed the never-miss-twice week strip on each card.
    const weekDays = lastNLocalDays(tz, 7)
    // A weekly quota only resolves a whole Mon–Sun week at a time, and the
    // never-miss-twice anchor can reach back into the previous one — so pull
    // logs from last week's Monday forward. ~14 days, still one query.
    const fromISO = shiftDays(weekDatesOf(date)[0], -7)

    const habitIds = habits.map((h) => h.id)
    const phaseIds = perHabit.map((p) => p.phase?.id).filter((id): id is string => !!id)
    const readyPhaseIds = perHabit
      .filter((p) => p.phase?.status === 'ready')
      .map((p) => p.phase!.id)

    const [repCounts, windowLogs, lastChecks] = await Promise.all([
      // Completed reps per active phase (target OR fail-safe), in one groupBy.
      phaseIds.length
        ? prisma.habitLog.groupBy({
            by: ['phaseId'],
            where: { phaseId: { in: phaseIds }, status: { in: ['target', 'failsafe'] } },
            _count: { _all: true },
          })
        : Promise.resolve([] as { phaseId: string | null; _count: { _all: number } }[]),
      // Every log in the resolution window, for every habit — one round-trip.
      habitIds.length
        ? prisma.habitLog.findMany({ where: { habitId: { in: habitIds }, date: { gte: fromISO, lte: date } } })
        : Promise.resolve([]),
      // Latest automaticity check for every "ready" phase (descending — first per
      // phase wins).
      readyPhaseIds.length
        ? prisma.automaticityCheck.findMany({
            where: { phaseId: { in: readyPhaseIds } },
            orderBy: { createdAt: 'desc' },
          })
        : Promise.resolve([]),
    ])

    const repByPhase = new Map(repCounts.map((r) => [r.phaseId, r._count._all]))
    const logByHabitDate = new Map(windowLogs.map((l) => [`${l.habitId}|${l.date}`, l]))
    const hitsByHabit = new Map<string, Set<string>>()
    for (const l of windowLogs) {
      if (l.status === 'miss') continue
      let set = hitsByHabit.get(l.habitId)
      if (!set) { set = new Set(); hitsByHabit.set(l.habitId, set) }
      set.add(l.date)
    }
    const lastCheckByPhase = new Map<string, (typeof lastChecks)[number]>()
    for (const c of lastChecks) {
      if (!lastCheckByPhase.has(c.phaseId)) lastCheckByPhase.set(c.phaseId, c)
    }

    const result = perHabit.map(({ habit: h, phase }) => {
      const reps = phase ? repByPhase.get(phase.id) ?? 0 : 0
      const todayLog = logByHabitDate.get(`${h.id}|${date}`) ?? null
      const automaticity = automaticityFromCheck(phase, phase ? lastCheckByPhase.get(phase.id) ?? null : null)

      // Materialize this habit's schedule across the window. For a fixed-day
      // habit this is weekday membership as before; for a weekly quota it's the
      // reserved-tail resolution.
      const sched = parseSchedule(h)
      const hitDates = hitsByHabit.get(h.id) ?? new Set<string>()
      const bounds = boundsOf(h, tz)
      const resolved = resolveRange(sched, fromISO, date, hitDates, bounds)
      const scheduledOn = new Map(resolved.map((d) => [d.date, d.scheduled]))
      const prevDate = previousScheduledDate(resolved, date)

      let wasPreviousMissed = false
      let previousMissNeedsReason = false
      if (prevDate) {
        const prevLog = logByHabitDate.get(`${h.id}|${prevDate}`)
        if (!prevLog || prevLog.status === 'miss') {
          wasPreviousMissed = true
          // "Needs a reason" = no log at all, or a miss with no explanation yet
          // (chips or note) — drives the "what got in the way yesterday?"
          // catch-up on the card.
          previousMissNeedsReason = !prevLog || !hasMissExplanation(prevLog.missReasons, prevLog.missNote)
        }
      }

      // Never-miss-twice strip: the last 7 days with schedule + outcome. Days
      // before the habit existed read as unscheduled so they render faint.
      const createdLocal = localDateInTz(h.createdAt, tz)
      const weekStrip = weekDays.map((w) => {
        const log = logByHabitDate.get(`${h.id}|${w.date}`) ?? null
        return {
          date: w.date,
          scheduled: scheduledOn.get(w.date) ?? false,
          status: log?.status ?? null,
          // Any day from the habit's creation up to today can be corrected from
          // the strip — including rest days you happened to do it on.
          editable: w.date >= createdLocal && w.date <= date,
        }
      })

      return {
        ...h,
        activePhase: phase,
        completedReps: reps,
        todayLog,
        automaticity,
        wasPreviousMissed,
        previousMissDate: wasPreviousMissed ? prevDate : null,
        previousMissNeedsReason,
        weekStrip,
        // Null for fixed-day habits — the client reads this instead of ever
        // resolving a schedule itself.
        weekProgress: weekProgress(sched, date, hitDates, bounds),
      }
    })

    res.json({ date, weekday, habits: result })
  } catch (err) {
    next(err)
  }
})

// GET / — all habits (for the Architect list / editing).
router.get('/', async (req: AuthRequest, res, next) => {
  try {
    const wsId = req.params.wsId as string
    await assertWorkstation(wsId, req.userId!)
    const habits = await prisma.habit.findMany({
      where: { workstationId: wsId, archivedAt: null },
      include: { phases: true, goal: { select: { id: true, title: true } } },
      orderBy: { createdAt: 'asc' },
    })
    res.json({ habits })
  } catch (err) {
    next(err)
  }
})

router.get('/:id', async (req: AuthRequest, res, next) => {
  try {
    const wsId = req.params.wsId as string
    await assertWorkstation(wsId, req.userId!)
    const habit = await prisma.habit.findFirst({
      where: { id: req.params.id as string, workstationId: wsId },
      include: { phases: true, goal: { select: { id: true, title: true } } },
    })
    if (!habit) { res.status(404).json({ error: 'Habit not found' }); return }
    const phase = activePhase(habit.phases)
    const reps = phase ? await completedReps(phase.id) : 0
    const automaticity = await automaticityState(phase)
    res.json({ habit: { ...habit, activePhase: phase, completedReps: reps, automaticity } })
  } catch (err) {
    next(err)
  }
})

// POST /:id/phases — define the next Phase after the current one graduates.
router.post('/:id/phases', async (req: AuthRequest, res, next) => {
  try {
    const wsId = req.params.wsId as string
    await assertWorkstation(wsId, req.userId!)
    const habit = await prisma.habit.findFirst({
      where: { id: req.params.id as string, workstationId: wsId },
      include: { phases: true },
    })
    if (!habit) { res.status(404).json({ error: 'Habit not found' }); return }

    const { targetText, definitionOfDone, targetCount, dailyLimit } = PhaseInput.parse(req.body)

    // Append to the ladder. If any phase is still live (active/ready/locked),
    // the new step is locked behind it; if the whole ladder has graduated, the
    // new step becomes active so the habit can keep climbing.
    const top = [...habit.phases].sort((a, b) => b.phaseNumber - a.phaseNumber)[0]
    const hasLive = habit.phases.some((p) => p.status !== 'graduated')

    const phase = await prisma.phase.create({
      data: {
        habitId: habit.id,
        phaseNumber: (top?.phaseNumber ?? 0) + 1,
        targetText,
        definitionOfDone: definitionOfDone ?? null,
        targetCount,
        dailyLimit: dailyLimit ?? null,
        status: hasLive ? 'locked' : 'active',
      },
    })
    res.status(201).json({ phase })
  } catch (err) {
    next(err)
  }
})

// PATCH /:id/phases/:phaseId — edit a non-graduated phase's target/floor.
router.patch('/:id/phases/:phaseId', async (req: AuthRequest, res, next) => {
  try {
    const wsId = req.params.wsId as string
    await assertWorkstation(wsId, req.userId!)
    const habit = await prisma.habit.findFirst({
      where: { id: req.params.id as string, workstationId: wsId },
      include: { phases: true },
    })
    if (!habit) { res.status(404).json({ error: 'Habit not found' }); return }
    const phase = habit.phases.find((p) => p.id === req.params.phaseId)
    if (!phase) { res.status(404).json({ error: 'Phase not found' }); return }
    if (phase.status === 'graduated') {
      res.status(400).json({ error: 'A graduated phase can’t be edited.' })
      return
    }
    const data = z.object({
      targetText: z.string().trim().min(1).max(300).optional(),
      definitionOfDone: z.string().trim().max(300).nullable().optional(),
      targetCount: z.number().int().min(1).max(1000).optional(),
      dailyLimit: z.number().int().min(0).max(1000).nullable().optional(),
    }).parse(req.body)
    const updated = await prisma.phase.update({ where: { id: phase.id }, data })
    res.json({ phase: updated })
  } catch (err) {
    next(err)
  }
})

// DELETE /:id/phases/:phaseId — drop an upcoming (locked) step from the ladder.
// Only locked phases can go: active/ready/graduated ones carry live progress
// and logged reps, so they're protected.
router.delete('/:id/phases/:phaseId', async (req: AuthRequest, res, next) => {
  try {
    const wsId = req.params.wsId as string
    await assertWorkstation(wsId, req.userId!)
    const habit = await prisma.habit.findFirst({
      where: { id: req.params.id as string, workstationId: wsId },
      include: { phases: true },
    })
    if (!habit) { res.status(404).json({ error: 'Habit not found' }); return }
    const phase = habit.phases.find((p) => p.id === req.params.phaseId)
    if (!phase) { res.status(404).json({ error: 'Phase not found' }); return }
    if (phase.status !== 'locked') {
      res.status(400).json({ error: 'Only an upcoming (locked) phase can be removed.' })
      return
    }
    await prisma.phase.delete({ where: { id: phase.id } })
    res.json({ ok: true })
  } catch (err) {
    next(err)
  }
})

const PatchSchema = z.object({
  goalId: z.string().trim().min(1).nullable().optional(),
  breakMode: BreakMode.nullable().optional(),
  avoidTrigger: z.string().trim().max(300).nullable().optional(),
  replacementAction: z.string().trim().max(300).nullable().optional(),
  frictionDevice: z.string().trim().max(300).nullable().optional(),
  checkStyle: z.enum(['hold', 'yesno']).optional(),
  checkQuestion: z.string().trim().max(200).nullable().optional(),
  title: z.string().trim().min(1).max(200).optional(),
  whyText: z.string().trim().max(2000).nullable().optional(),
  whyImageUrl: z.string().trim().max(2000).nullable().optional(),
  cueType: CueType.optional(),
  anchorRoutine: z.string().trim().max(300).nullable().optional(),
  cueTime: z.string().trim().max(20).nullable().optional(),
  cueLocation: z.string().trim().max(200).nullable().optional(),
  failSafeAction: z.string().trim().min(1).max(300).optional(),
  celebration: z.string().trim().max(200).nullable().optional(),
  temptationBundle: z.string().trim().max(200).nullable().optional(),
  scheduleType: ScheduleType.optional(),
  scheduleDays: z.array(z.number().int().min(0).max(6)).min(1).optional(),
  timesPerWeek: z.number().int().min(1).max(6).nullable().optional(),
  reminderTime: z.string().trim().regex(/^\d{1,2}:\d{2}$/).max(5).nullable().optional(),
  reminderEnabled: z.boolean().optional(),
  nightstandRule: z.string().trim().max(500).nullable().optional(),
  setbackPlans: SetbackPlanInput.optional(),
  systemFocusConfirmed: z.boolean().optional(),
  sectionNotes: SectionNotesInput.optional(),
})

router.patch('/:id', async (req: AuthRequest, res, next) => {
  try {
    const wsId = req.params.wsId as string
    await assertWorkstation(wsId, req.userId!)
    const existing = await prisma.habit.findFirst({
      where: { id: req.params.id as string, workstationId: wsId },
    })
    if (!existing) { res.status(404).json({ error: 'Habit not found' }); return }

    const data = PatchSchema.parse(req.body)
    if (data.goalId) await assertGoal(data.goalId, wsId)

    // Taper habits log a daily count — a yes/no question can't carry one.
    const effStyle = data.checkStyle ?? existing.checkStyle
    const effBreakMode = data.breakMode !== undefined ? data.breakMode : existing.breakMode
    if (effStyle === 'yesno' && existing.kind === 'break' && effBreakMode === 'taper') {
      res.status(400).json({ error: 'Taper habits use a daily count, not a yes/no question.' })
      return
    }

    // Re-validate the cue against the effective (incoming-or-existing) values so
    // a partial edit can't leave the habit without a concrete trigger.
    assertConcreteCue({
      kind: existing.kind as 'build' | 'break',
      cueType: (data.cueType ?? existing.cueType) as 'habit_stack' | 'time' | 'location',
      anchorRoutine: data.anchorRoutine !== undefined ? data.anchorRoutine : existing.anchorRoutine,
      cueTime: data.cueTime !== undefined ? data.cueTime : existing.cueTime,
      cueLocation: data.cueLocation !== undefined ? data.cueLocation : existing.cueLocation,
      avoidTrigger: data.avoidTrigger !== undefined ? data.avoidTrigger : existing.avoidTrigger,
    })

    const updateData: Record<string, unknown> = { ...data }
    if (data.scheduleDays) updateData.scheduleDays = JSON.stringify(data.scheduleDays)
    // The two modes are mutually exclusive: switching to fixed days clears the
    // quota, and a weekly habit must carry one. Guard against a partial patch
    // leaving a 'weekly' row with a null timesPerWeek.
    const effType = data.scheduleType ?? existing.scheduleType
    if (effType === 'weekly') {
      const quota = data.timesPerWeek !== undefined ? data.timesPerWeek : existing.timesPerWeek
      if (!quota) { res.status(400).json({ error: 'A weekly habit needs a number of times per week.' }); return }
      updateData.timesPerWeek = quota
    } else if (data.scheduleType === 'days') {
      updateData.timesPerWeek = null
    }
    if (data.setbackPlans) updateData.setbackPlans = JSON.stringify(data.setbackPlans)
    if (data.sectionNotes) updateData.sectionNotes = JSON.stringify(data.sectionNotes)

    const habit = await prisma.habit.update({
      where: { id: existing.id },
      data: updateData,
      include: { phases: true, goal: { select: { id: true, title: true } } },
    })
    res.json({ habit })
  } catch (err) {
    next(err)
  }
})

router.delete('/:id', async (req: AuthRequest, res, next) => {
  try {
    const wsId = req.params.wsId as string
    await assertWorkstation(wsId, req.userId!)
    const existing = await prisma.habit.findFirst({
      where: { id: req.params.id as string, workstationId: wsId },
    })
    if (!existing) { res.status(404).json({ error: 'Habit not found' }); return }
    await prisma.habit.update({
      where: { id: existing.id },
      data: { archivedAt: new Date() },
    })
    res.json({ ok: true })
  } catch (err) {
    next(err)
  }
})

// Pause / resume — a reversible rest for "it's too much right now". Paused habits
// drop off Today, stop reminders, and stop decaying rhythm (see momentum.ts), but
// keep their full history. `paused` in the body toggles the state.
router.post('/:id/pause', async (req: AuthRequest, res, next) => {
  try {
    const wsId = req.params.wsId as string
    await assertWorkstation(wsId, req.userId!)
    const { paused } = z.object({ paused: z.boolean() }).parse(req.body)
    const existing = await prisma.habit.findFirst({
      where: { id: req.params.id as string, workstationId: wsId, archivedAt: null },
    })
    if (!existing) { res.status(404).json({ error: 'Habit not found' }); return }
    const habit = await prisma.habit.update({
      where: { id: existing.id },
      data: { pausedAt: paused ? new Date() : null },
      include: { phases: true },
    })
    res.json({ habit })
  } catch (err) {
    next(err)
  }
})

export default router
