import { Router } from 'express'
import { prisma } from '../lib/prisma.js'
import { requireAuth, AuthRequest } from '../middleware/auth.js'

const router = Router()
router.use(requireAuth)

// A habit user has exactly one container; list returns it (auto-created at sync).
router.get('/', async (req: AuthRequest, res, next) => {
  try {
    let workstations = await prisma.workstation.findMany({
      where: { userId: req.userId!, deletedAt: null },
      orderBy: { createdAt: 'asc' },
    })
    if (workstations.length === 0) {
      const ws = await prisma.workstation.create({
        data: { userId: req.userId!, name: 'My Habits' },
      })
      workstations = [ws]
    }
    res.json({ workstations })
  } catch (err) {
    next(err)
  }
})

export default router
