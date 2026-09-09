import { Router } from 'express'
import { z } from 'zod'
import { prisma } from '../lib/prisma.js'
import { requireAuth, AuthRequest } from '../middleware/auth.js'
import { assertWorkstation } from '../lib/workstation.js'

const router = Router({ mergeParams: true })
router.use(requireAuth)

router.get('/nodes', async (req: AuthRequest, res, next) => {
  try {
    const wsId = req.params.wsId as string
    await assertWorkstation(wsId, req.userId!)
    const nodes = await prisma.canvasNode.findMany({
      where: { workstationId: wsId },
      orderBy: { createdAt: 'asc' },
    })
    res.json({ nodes })
  } catch (err) {
    next(err)
  }
})

const CreateSchema = z.object({
  type: z.enum(['text', 'quote', 'note', 'image']).default('note'),
  content: z.string().max(4000).default(''),
  // Allows either a plain URL or a compressed data: URL (drag-dropped images).
  imageUrl: z.string().max(8_000_000).nullable().optional(),
  x: z.number().default(0),
  y: z.number().default(0),
  width: z.number().min(120).max(600).optional(),
  color: z.enum(['yellow', 'blue', 'green', 'pink', 'plain']).default('yellow'),
})

router.post('/nodes', async (req: AuthRequest, res, next) => {
  try {
    const wsId = req.params.wsId as string
    await assertWorkstation(wsId, req.userId!)
    const body = CreateSchema.parse(req.body)
    const node = await prisma.canvasNode.create({
      data: {
        workstationId: wsId,
        type: body.type,
        content: body.content,
        imageUrl: body.imageUrl ?? null,
        x: body.x,
        y: body.y,
        width: body.width ?? 220,
        color: body.color,
      },
    })
    res.status(201).json({ node })
  } catch (err) {
    next(err)
  }
})

const PatchSchema = z.object({
  content: z.string().max(4000).optional(),
  // Allows either a plain URL or a compressed data: URL (drag-dropped images).
  imageUrl: z.string().max(8_000_000).nullable().optional(),
  x: z.number().optional(),
  y: z.number().optional(),
  width: z.number().min(120).max(600).optional(),
  color: z.enum(['yellow', 'blue', 'green', 'pink', 'plain']).optional(),
})

router.patch('/nodes/:id', async (req: AuthRequest, res, next) => {
  try {
    const wsId = req.params.wsId as string
    await assertWorkstation(wsId, req.userId!)
    const existing = await prisma.canvasNode.findFirst({
      where: { id: req.params.id as string, workstationId: wsId },
    })
    if (!existing) { res.status(404).json({ error: 'Node not found' }); return }
    const data = PatchSchema.parse(req.body)
    const node = await prisma.canvasNode.update({ where: { id: existing.id }, data })
    res.json({ node })
  } catch (err) {
    next(err)
  }
})

router.delete('/nodes/:id', async (req: AuthRequest, res, next) => {
  try {
    const wsId = req.params.wsId as string
    await assertWorkstation(wsId, req.userId!)
    const existing = await prisma.canvasNode.findFirst({
      where: { id: req.params.id as string, workstationId: wsId },
    })
    if (!existing) { res.status(404).json({ error: 'Node not found' }); return }
    await prisma.canvasNode.delete({ where: { id: existing.id } })
    res.json({ ok: true })
  } catch (err) {
    next(err)
  }
})

export default router
