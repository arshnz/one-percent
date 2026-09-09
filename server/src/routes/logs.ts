import { Router } from 'express'
import { z } from 'zod'
import { prisma } from '../lib/prisma.js'
import { requireAuth, AuthRequest } from '../middleware/auth.js'
import { assertWorkstation } from '../lib/workstation.js'

const router = Router({ mergeParams: true })
router.use(requireAuth)

const WEEKDAYS = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat']

function localDate(timezone: string): string {
  try {
    return new Intl.DateTimeFormat('en-CA', { timeZone: timezone }).format(new Date())
  } catch {
    return new Intl.DateTimeFormat('en-CA').format(new Date())
  }
}

// Editing history is bounded to the WeekStrip's window: today back to 6 days ago
// (7 days inclusive). Guards backdated votes and undos alike.
function isWithinEditWindow(date: string, today: string): boolean {
  const sixDaysAgo = new Date(Date.now() - 6 * 86_400_000).toISOString().slice(0, 10)
  return date <= today && date >= sixDaysAgo
}

const BodySchema = z.object({
  // 'miss' is an explicit relapse (break habits). For taper habits the status is
  // derived from `quantity` instead, so status may be omitted when quantity is set.
  status: z.enum(['target', 'failsafe', 'miss']).optional(),
  // Taper break habits: how many times the bad habit happened today.
  quantity: z.number().int().min(0).max(1000).optional(),
  goldilocks: z.enum(['too_easy', 'just_right', 'too_hard']).optional().nullable(),
  date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional(),
  // "What got in the way?" — chip strings + an optional free-text note.
  missReasons: z.array(z.string().trim().min(1).max(60)).max(5).optional(),
  missNote: z.string().trim().max(500).optional().nullable(),
}).refine((b) => b.status !== undefined || b.quantity !== undefined, {
  message: 'Provide a status or a quantity.',
})

const ReasonSchema = z.object({
  date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
  reasons: z.array(z.string().trim().min(1).max(60)).max(5),
  note: z.string().trim().max(500).optional().nullable(),
})

// POST / — record today's completion (or update its Goldilocks rating).
// Each target/failsafe is one Identity Vote. Reaching the rep floor makes the
// phase `ready` for the Automaticity Check. A `miss` (relapse) records the day
// without a vote and never claws back banked progress.
router.post('/', async (req: AuthRequest, res, next) => {
  try {
    const wsId = req.params.wsId as string
    const habitId = req.params.habitId as string
    await assertWorkstation(wsId, req.userId!)

    const habit = await prisma.habit.findFirst({
      where: { id: habitId, workstationId: wsId },
      include: { phases: true },
    })
    if (!habit) { res.status(404).json({ error: 'Habit not found' }); return }

    const body = BodySchema.parse(req.body)
    const user = await prisma.user.findUnique({ where: { id: req.userId! } })
    const today = localDate(user?.timezone ?? 'Pacific/Auckland')
    const date = body.date ?? today
    // Backdated edits (the WeekStrip's "fix a past day") are capped to the last
    // 7 days; today's own vote is always allowed.
    if (body.date && !isWithinEditWindow(body.date, today)) {
      res.status(400).json({ error: 'You can only log for the last 7 days.' })
      return
    }

    const phase =
      habit.phases.find((p) => p.status === 'active') ??
      [...habit.phases].sort((a, b) => b.phaseNumber - a.phaseNumber)[0] ??
      null

    // Taper break habits log a daily count; the day counts as a vote when it's at
    // or under the phase's limit, otherwise it's a relapse (miss).
    let status = body.status
    if (body.quantity !== undefined && habit.kind === 'break' && habit.breakMode === 'taper') {
      const limit = phase?.dailyLimit ?? 0
      status = body.quantity <= limit ? 'target' : 'miss'
    }
    if (!status) status = 'target'

    const log = await prisma.habitLog.upsert({
      where: { habitId_date: { habitId, date } },
      update: {
        status,
        quantity: body.quantity ?? null,
        goldilocks: body.goldilocks ?? null,
        phaseId: phase?.id ?? null,
        // Only touch the reason fields when provided, so a re-vote or a
        // Goldilocks rating never wipes an earlier "what got in the way".
        ...(body.missReasons !== undefined ? { missReasons: JSON.stringify(body.missReasons) } : {}),
        ...(body.missNote !== undefined ? { missNote: body.missNote ?? null } : {}),
      },
      create: {
        habitId,
        phaseId: phase?.id ?? null,
        date,
        status,
        quantity: body.quantity ?? null,
        goldilocks: body.goldilocks ?? null,
        missReasons: JSON.stringify(body.missReasons ?? []),
        missNote: body.missNote ?? null,
      },
    })

    // Recompute progress. Reaching the rep floor no longer graduates the phase —
    // it makes it `ready` for the Automaticity Check (SRBAI), which is what
    // actually graduates it.
    let ready = false
    let completedReps = 0
    if (phase) {
      completedReps = await prisma.habitLog.count({
        where: { phaseId: phase.id, status: { in: ['target', 'failsafe'] } },
      })
      if (phase.status === 'active' && completedReps >= phase.targetCount) {
        await prisma.phase.update({
          where: { id: phase.id },
          data: { status: 'ready' },
        })
        ready = true
      }
    }

    res.status(201).json({ log, completedReps, ready })
  } catch (err) {
    next(err)
  }
})

// POST /reason — record "what got in the way" for a day, without disturbing the
// rest of the log. Kept off the main upsert so annotating never clobbers a taper
// quantity or Goldilocks rating. When the day has no log at all (a silent miss
// being explained the next day or at the weekly check-in), backfill a `miss` row
// — misses never count as votes, so this has no effect on phases or rhythm.
router.post('/reason', async (req: AuthRequest, res, next) => {
  try {
    const wsId = req.params.wsId as string
    const habitId = req.params.habitId as string
    await assertWorkstation(wsId, req.userId!)

    const habit = await prisma.habit.findFirst({
      where: { id: habitId, workstationId: wsId },
      include: { phases: true },
    })
    if (!habit) { res.status(404).json({ error: 'Habit not found' }); return }

    const body = ReasonSchema.parse(req.body)
    const user = await prisma.user.findUnique({ where: { id: req.userId! } })
    const today = localDate(user?.timezone ?? 'Pacific/Auckland')
    const weekAgo = new Date(Date.now() - 7 * 86_400_000).toISOString().slice(0, 10)
    if (body.date > today || body.date < weekAgo) {
      res.status(400).json({ error: 'Reasons can only be recorded for the last 7 days.' })
      return
    }

    const existing = await prisma.habitLog.findUnique({
      where: { habitId_date: { habitId, date: body.date } },
    })

    const log = existing
      ? await prisma.habitLog.update({
          where: { id: existing.id },
          data: { missReasons: JSON.stringify(body.reasons), missNote: body.note ?? null },
        })
      : await prisma.habitLog.create({
          data: {
            habitId,
            phaseId: habit.phases.find((p) => p.status === 'active')?.id ?? null,
            date: body.date,
            status: 'miss',
            missReasons: JSON.stringify(body.reasons),
            missNote: body.note ?? null,
          },
        })

    res.status(201).json({ log })
  } catch (err) {
    next(err)
  }
})

// DELETE / — clear a day's log for this habit. Defaults to today; pass
// ?date=YYYY-MM-DD to clear a past day (from the WeekStrip), within the last 7.
router.delete('/', async (req: AuthRequest, res, next) => {
  try {
    const wsId = req.params.wsId as string
    const habitId = req.params.habitId as string
    await assertWorkstation(wsId, req.userId!)

    const habit = await prisma.habit.findFirst({
      where: { id: habitId, workstationId: wsId },
      include: { phases: true },
    })
    if (!habit) { res.status(404).json({ error: 'Habit not found' }); return }

    const user = await prisma.user.findUnique({ where: { id: req.userId! } })
    const today = localDate(user?.timezone ?? 'Pacific/Auckland')
    const rawDate = typeof req.query.date === 'string' ? req.query.date : undefined
    if (rawDate && !/^\d{4}-\d{2}-\d{2}$/.test(rawDate)) {
      res.status(400).json({ error: 'Invalid date.' }); return
    }
    if (rawDate && !isWithinEditWindow(rawDate, today)) {
      res.status(400).json({ error: 'You can only edit the last 7 days.' }); return
    }
    const date = rawDate ?? today

    const log = await prisma.habitLog.findUnique({
      where: { habitId_date: { habitId, date } },
    })
    if (!log) { res.status(404).json({ error: 'No log for that day' }); return }

    await prisma.habitLog.delete({ where: { id: log.id } })

    // If this log pushed the phase into 'ready', revert it to 'active'.
    const phase = habit.phases.find((p) => p.id === log.phaseId)
    if (phase && phase.status === 'ready') {
      const repsAfter = await prisma.habitLog.count({
        where: { phaseId: phase.id, status: { in: ['target', 'failsafe'] } },
      })
      if (repsAfter < phase.targetCount) {
        await prisma.phase.update({ where: { id: phase.id }, data: { status: 'active' } })
      }
    }

    res.json({ ok: true })
  } catch (err) {
    next(err)
  }
})

export default router
