import { Router } from 'express'
import { z } from 'zod'
import { prisma } from '../lib/prisma.js'
import { requireAuth, requireFirebase, AuthRequest } from '../middleware/auth.js'

const router = Router()

// Sync route is called immediately after Firebase Auth succeeds on the client.
// Uses requireFirebase (not requireAuth) because the Prisma user row may not
// exist yet — this is the route that creates it.
router.post('/sync', requireFirebase, async (req: AuthRequest, res, next) => {
  try {
    if (!req.userEmail) {
      res.status(400).json({ error: 'No email found in Firebase token' })
      return
    }

    const { name } = z.object({
      name: z.string().trim().min(1).max(100).optional(),
    }).parse(req.body ?? {})

    // Find or create the user in Prisma
    const user = await prisma.user.upsert({
      where: { email: req.userEmail },
      update: {}, // Don't override existing name if already set
      create: {
        email: req.userEmail,
        name: name || req.userEmail.split('@')[0], // Fallback name
        password: '', // Password is not used anymore as Firebase handles it
      },
      // Return the full user shape so the client can boot from /sync alone,
      // without a follow-up /me round-trip.
      select: { id: true, email: true, name: true, timezone: true, personalContext: true, assessment: true, emailReminders: true, pushReminders: true },
    })

    // Ensure the user has their single default habit container.
    const existing = await prisma.workstation.findFirst({
      where: { userId: user.id, deletedAt: null },
    })
    if (!existing) {
      await prisma.workstation.create({
        data: { userId: user.id, name: 'My Habits' },
      })
    }

    res.json({ user })
  } catch (err) {
    next(err)
  }
})

router.post('/logout', (req, res) => {
  // Clear any old custom session cookies just in case
  res.clearCookie('__session')
  res.json({ ok: true })
})

router.get('/me', requireAuth, async (req: AuthRequest, res, next) => {
  try {
    if (!req.userId) {
      res.status(404).json({ error: 'User not found in database' })
      return
    }
    const user = await prisma.user.findUnique({
      where: { id: req.userId },
      select: { id: true, email: true, name: true, timezone: true, personalContext: true, assessment: true, emailReminders: true, pushReminders: true },
    })
    if (!user) {
      res.status(404).json({ error: 'User not found' })
      return
    }
    res.json({ user })
  } catch (err) {
    next(err)
  }
})

router.patch('/me', requireAuth, async (req: AuthRequest, res, next) => {
  try {
    if (!req.userId) {
      res.status(404).json({ error: 'User not found in database' })
      return
    }
    const Schema = z.object({
      name: z.string().trim().min(1).max(100).optional(),
      timezone: z.string().refine((tz) => {
        try { new Intl.DateTimeFormat('en', { timeZone: tz }); return true } catch { return false }
      }, 'Invalid timezone').optional(),
      personalContext: z.string().max(2000).optional(),
      // Compass assessment snapshot — validated structure, stored as JSON text.
      assessment: z.object({
        contentment: z.array(z.object({
          domain: z.string().max(60),
          score: z.number().min(1).max(10),
        })).max(10).optional(),
        priorities: z.array(z.string().max(300)).max(10).optional(),
        highQualityHours: z.string().max(500).optional(),
        pastStickyHabits: z.array(z.object({
          habit: z.string().max(300),
          whyItStuck: z.string().max(500),
        })).max(10).optional(),
        obstacles: z.array(z.string().max(300)).max(10).optional(),
        updatedAt: z.string().max(40).optional(),
      }).optional(),
      emailReminders: z.boolean().optional(),
      pushReminders: z.boolean().optional(),
    })
    const { assessment, ...rest } = Schema.parse(req.body)
    const user = await prisma.user.update({
      where: { id: req.userId },
      data: { ...rest, ...(assessment ? { assessment: JSON.stringify(assessment) } : {}) },
      select: { id: true, email: true, name: true, timezone: true, personalContext: true, assessment: true, emailReminders: true, pushReminders: true },
    })
    res.json({ user })
  } catch (err) {
    next(err)
  }
})

export default router
