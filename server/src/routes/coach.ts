import { Router } from 'express'
import { z } from 'zod'
import { prisma } from '../lib/prisma.js'
import { requireAuth, AuthRequest } from '../middleware/auth.js'
import { assertWorkstation } from '../lib/workstation.js'

// CRUD for saved Habit Coach conversations. The streaming generation endpoint
// (and the message persistence that goes with it) lives in routes/ai.ts at
// POST /api/ai/coach — this router only manages the conversation records.
const router = Router({ mergeParams: true })
router.use(requireAuth)

// List a workstation's chats, most-recently-active first.
router.get('/conversations', async (req: AuthRequest, res, next) => {
  try {
    const wsId = req.params.wsId as string
    await assertWorkstation(wsId, req.userId!)
    const conversations = await prisma.coachConversation.findMany({
      where: { workstationId: wsId },
      orderBy: { lastMessageAt: 'desc' },
      select: { id: true, title: true, createdAt: true, lastMessageAt: true },
    })
    res.json({ conversations })
  } catch (err) {
    next(err)
  }
})

router.post('/conversations', async (req: AuthRequest, res, next) => {
  try {
    const wsId = req.params.wsId as string
    await assertWorkstation(wsId, req.userId!)
    const conversation = await prisma.coachConversation.create({
      data: { workstationId: wsId },
      select: { id: true, title: true, createdAt: true, lastMessageAt: true },
    })
    res.status(201).json({ conversation })
  } catch (err) {
    next(err)
  }
})

// Full thread, oldest message first.
router.get('/conversations/:id', async (req: AuthRequest, res, next) => {
  try {
    const wsId = req.params.wsId as string
    await assertWorkstation(wsId, req.userId!)
    const conversation = await prisma.coachConversation.findFirst({
      where: { id: req.params.id as string, workstationId: wsId },
      include: { messages: { orderBy: { createdAt: 'asc' }, select: { role: true, text: true } } },
    })
    if (!conversation) { res.status(404).json({ error: 'Conversation not found' }); return }
    res.json({ conversation })
  } catch (err) {
    next(err)
  }
})

router.patch('/conversations/:id', async (req: AuthRequest, res, next) => {
  try {
    const wsId = req.params.wsId as string
    await assertWorkstation(wsId, req.userId!)
    const { title } = z.object({ title: z.string().trim().min(1).max(120) }).parse(req.body)
    const existing = await prisma.coachConversation.findFirst({
      where: { id: req.params.id as string, workstationId: wsId },
    })
    if (!existing) { res.status(404).json({ error: 'Conversation not found' }); return }
    const conversation = await prisma.coachConversation.update({
      where: { id: existing.id },
      data: { title },
      select: { id: true, title: true, createdAt: true, lastMessageAt: true },
    })
    res.json({ conversation })
  } catch (err) {
    next(err)
  }
})

router.delete('/conversations/:id', async (req: AuthRequest, res, next) => {
  try {
    const wsId = req.params.wsId as string
    await assertWorkstation(wsId, req.userId!)
    const existing = await prisma.coachConversation.findFirst({
      where: { id: req.params.id as string, workstationId: wsId },
    })
    if (!existing) { res.status(404).json({ error: 'Conversation not found' }); return }
    await prisma.coachConversation.delete({ where: { id: existing.id } })
    res.json({ ok: true })
  } catch (err) {
    next(err)
  }
})

export default router
