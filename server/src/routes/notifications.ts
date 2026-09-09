import { Router } from 'express'
import { z } from 'zod'
import { prisma } from '../lib/prisma.js'
import { requireAuth, AuthRequest } from '../middleware/auth.js'
import { getVapidPublicKey } from '../lib/push.js'
import { runReminders } from '../lib/reminders.js'
import { runDailyDigest } from '../lib/digest.js'
import { runCheckinNudge } from '../lib/checkinNudge.js'

const router = Router()
router.use(requireAuth)

// The browser needs the VAPID public key to build a PushManager subscription.
router.get('/vapid-public-key', (_req, res) => {
  const key = getVapidPublicKey()
  if (!key) { res.status(503).json({ error: 'Push not configured' }); return }
  res.json({ key })
})

const SubscribeSchema = z.object({
  endpoint: z.string().url().max(1000),
  keys: z.object({
    p256dh: z.string().min(1).max(500),
    auth: z.string().min(1).max(500),
  }),
})

// Store (or refresh) this device's push endpoint for the current user.
router.post('/subscribe', async (req: AuthRequest, res, next) => {
  try {
    const { endpoint, keys } = SubscribeSchema.parse(req.body)
    await prisma.pushSubscription.upsert({
      where: { endpoint },
      update: { userId: req.userId!, p256dh: keys.p256dh, auth: keys.auth },
      create: { userId: req.userId!, endpoint, p256dh: keys.p256dh, auth: keys.auth },
    })
    res.json({ ok: true })
  } catch (err) {
    next(err)
  }
})

router.post('/unsubscribe', async (req: AuthRequest, res, next) => {
  try {
    const { endpoint } = z.object({ endpoint: z.string().max(1000) }).parse(req.body)
    await prisma.pushSubscription.deleteMany({ where: { endpoint, userId: req.userId! } })
    res.json({ ok: true })
  } catch (err) {
    next(err)
  }
})

// Self-trigger: runs the nudge engine for THIS user only, bypassing the
// time-of-day window (so you can test without waiting for the cron). Still
// respects the per-day dedup and the already-logged check.
router.post('/test-run', async (req: AuthRequest, res, next) => {
  try {
    const now = new Date()
    const reminders = await runReminders(prisma, now, { userId: req.userId!, ignoreWindow: true })
    const digest = await runDailyDigest(prisma, now, { userId: req.userId!, ignoreWindow: true })
    const checkinNudge = await runCheckinNudge(prisma, now, { userId: req.userId!, ignoreWindow: true })
    res.json({ reminders, digest, checkinNudge })
  } catch (err) {
    next(err)
  }
})

export default router
