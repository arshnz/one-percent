import { Router } from 'express'
import { z } from 'zod'
import { prisma } from '../lib/prisma.js'
import { requireAuth, AuthRequest } from '../middleware/auth.js'
import { assertWorkstation } from '../lib/workstation.js'

const router = Router({ mergeParams: true })
router.use(requireAuth)

const Domain = z.enum(['health', 'career', 'relationships', 'money', 'mind'])
const Status = z.enum(['active', 'achieved', 'shelved'])

router.get('/', async (req: AuthRequest, res, next) => {
  try {
    const wsId = req.params.wsId as string
    await assertWorkstation(wsId, req.userId!)
    const goals = await prisma.goal.findMany({
      where: { workstationId: wsId },
      include: { habits: { where: { archivedAt: null }, select: { id: true, title: true } } },
      orderBy: { createdAt: 'asc' },
    })
    res.json({ goals })
  } catch (err) {
    next(err)
  }
})

const CreateSchema = z.object({
  title: z.string().trim().min(1).max(300),
  domain: Domain.default('health'),
  whyText: z.string().trim().max(2000).optional().nullable(),
  timeframe: z.string().trim().max(120).optional().nullable(),
  sourceNote: z.string().max(20_000).optional().nullable(),
})

router.post('/', async (req: AuthRequest, res, next) => {
  try {
    const wsId = req.params.wsId as string
    await assertWorkstation(wsId, req.userId!)
    const body = CreateSchema.parse(req.body)
    const goal = await prisma.goal.create({
      data: {
        workstationId: wsId,
        title: body.title,
        domain: body.domain,
        whyText: body.whyText ?? null,
        timeframe: body.timeframe ?? null,
        sourceNote: body.sourceNote ?? null,
      },
    })
    res.status(201).json({ goal })
  } catch (err) {
    next(err)
  }
})

const PatchSchema = z.object({
  title: z.string().trim().min(1).max(300).optional(),
  domain: Domain.optional(),
  whyText: z.string().trim().max(2000).nullable().optional(),
  timeframe: z.string().trim().max(120).nullable().optional(),
  status: Status.optional(),
})

router.patch('/:id', async (req: AuthRequest, res, next) => {
  try {
    const wsId = req.params.wsId as string
    await assertWorkstation(wsId, req.userId!)
    const existing = await prisma.goal.findFirst({
      where: { id: req.params.id as string, workstationId: wsId },
    })
    if (!existing) { res.status(404).json({ error: 'Goal not found' }); return }
    const data = PatchSchema.parse(req.body)
    const goal = await prisma.goal.update({ where: { id: existing.id }, data })
    res.json({ goal })
  } catch (err) {
    next(err)
  }
})

router.delete('/:id', async (req: AuthRequest, res, next) => {
  try {
    const wsId = req.params.wsId as string
    await assertWorkstation(wsId, req.userId!)
    const existing = await prisma.goal.findFirst({
      where: { id: req.params.id as string, workstationId: wsId },
    })
    if (!existing) { res.status(404).json({ error: 'Goal not found' }); return }
    // Habits linked to this goal keep living — goalId is set null by the FK.
    await prisma.goal.delete({ where: { id: existing.id } })
    res.json({ ok: true })
  } catch (err) {
    next(err)
  }
})

export default router
