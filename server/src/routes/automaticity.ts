import { Router } from 'express'
import { z } from 'zod'
import { prisma } from '../lib/prisma.js'
import { requireAuth, AuthRequest } from '../middleware/auth.js'
import { assertWorkstation } from '../lib/workstation.js'

const router = Router({ mergeParams: true })
router.use(requireAuth)

const PASS_THRESHOLD = 4.0 // mean of 4 SRBAI items (1–5) — tunable
const REPROMPT_DAYS = 7

function activePhase<T extends { status: string; phaseNumber: number }>(phases: T[]): T | null {
  return (
    phases.find((p) => p.status === 'ready') ??
    phases.find((p) => p.status === 'active') ??
    [...phases].sort((a, b) => b.phaseNumber - a.phaseNumber)[0] ??
    null
  )
}

// GET / — is this habit's active phase eligible for the Automaticity Check, and
// is a check due right now?
router.get('/', async (req: AuthRequest, res, next) => {
  try {
    const wsId = req.params.wsId as string
    const habitId = req.params.habitId as string
    await assertWorkstation(wsId, req.userId!)
    const habit = await prisma.habit.findFirst({
      where: { id: habitId, workstationId: wsId },
      include: { phases: true },
    })
    if (!habit) { res.status(404).json({ error: 'Habit not found' }); return }

    const phase = activePhase(habit.phases)
    const eligible = phase?.status === 'ready'
    const lastCheck = phase
      ? await prisma.automaticityCheck.findFirst({
          where: { phaseId: phase.id },
          orderBy: { createdAt: 'desc' },
        })
      : null

    // Due if eligible AND (never checked, or the last check failed > 7 days ago).
    let due = false
    if (eligible) {
      if (!lastCheck) due = true
      else if (!lastCheck.passed) {
        const days = (Date.now() - new Date(lastCheck.createdAt).getTime()) / 86_400_000
        due = days >= REPROMPT_DAYS
      }
    }

    res.json({ eligible, due, lastCheck })
  } catch (err) {
    next(err)
  }
})

// POST / — submit a 4-item SRBAI. Passing graduates the active phase.
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

    const phase = activePhase(habit.phases)
    if (!phase || phase.status !== 'ready') {
      res.status(400).json({ error: 'This habit is not ready for an Automaticity Check yet.' })
      return
    }

    const { scores } = z.object({
      scores: z.array(z.number().int().min(1).max(5)).length(4),
    }).parse(req.body)

    const mean = scores.reduce((a, b) => a + b, 0) / scores.length
    const passed = mean >= PASS_THRESHOLD

    const check = await prisma.automaticityCheck.create({
      data: { habitId, phaseId: phase.id, scores: JSON.stringify(scores), mean, passed },
    })

    // Passing graduates the phase and auto-promotes the next locked step in the
    // pre-mapped ladder (if any) so the climb continues without a manual setup.
    let advanced = false
    let nextPhaseNumber: number | null = null
    if (passed) {
      await prisma.phase.update({
        where: { id: phase.id },
        data: { status: 'graduated', graduatedAt: new Date() },
      })
      const next = habit.phases
        .filter((p) => p.status === 'locked' && p.phaseNumber > phase.phaseNumber)
        .sort((a, b) => a.phaseNumber - b.phaseNumber)[0]
      if (next) {
        await prisma.phase.update({ where: { id: next.id }, data: { status: 'active' } })
        advanced = true
        nextPhaseNumber = next.phaseNumber
      }
    }

    res.status(201).json({ check, passed, mean, advanced, nextPhaseNumber })
  } catch (err) {
    next(err)
  }
})

export default router
