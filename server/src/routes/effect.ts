import { Router } from 'express'
import { z } from 'zod'
import { prisma } from '../lib/prisma.js'
import { requireAuth, AuthRequest } from '../middleware/auth.js'
import { assertWorkstation } from '../lib/workstation.js'
import { computeHabitEffects } from '../lib/habitEffect.js'
import { WEARABLE_METRIC_KEYS, WEARABLE_METRICS, type WearableMetric } from '../lib/wearableMetrics.js'

// "Does this habit move this number?" — the read side. The analysis itself, and
// the reasoning about what it may and may not claim, lives in lib/habitEffect.ts.

const router = Router({ mergeParams: true })
router.use(requireAuth)

const MetricSchema = z.enum(WEARABLE_METRIC_KEYS as [WearableMetric, ...WearableMetric[]])

const LinkSchema = z.object({
  metric: MetricSchema,
  // 0 = the same day, 1 = the night after. Beyond a week the story gets too
  // tangled with everything else in the person's life to mean anything.
  lagDays: z.number().int().min(0).max(7).default(1),
})

async function assertHabit(wsId: string, habitId: string, userId: string) {
  await assertWorkstation(wsId, userId)
  const habit = await prisma.habit.findFirst({ where: { id: habitId, workstationId: wsId } })
  if (!habit) throw Object.assign(new Error('Habit not found'), { status: 404 })
  return habit
}

// GET / — every configured link for this habit, each with its current verdict.
// An empty `results` means nothing is linked yet, not that nothing was found.
router.get('/', async (req: AuthRequest, res, next) => {
  try {
    const wsId = req.params.wsId as string
    const habitId = req.params.habitId as string
    await assertHabit(wsId, habitId, req.userId!)
    const tz = req.userTimezone ?? 'Pacific/Auckland'

    const links = await prisma.habitMetricLink.findMany({
      where: { habitId },
      orderBy: { createdAt: 'asc' },
    })

    // One batched call: the permutation tests are ~80ms each, but a separate
    // call would re-fetch the habit, its logs and its wearable days.
    const results = await computeHabitEffects(
      habitId,
      req.userId!,
      links.map((l) => ({ metric: l.metric as WearableMetric, lagDays: l.lagDays })),
      tz
    )

    res.json({ results })
  } catch (err) {
    next(err)
  }
})

// GET /available — the metrics that can be linked, and which already are.
// Drives the picker without the client hardcoding a second copy of the list.
router.get('/available', async (req: AuthRequest, res, next) => {
  try {
    const wsId = req.params.wsId as string
    const habitId = req.params.habitId as string
    await assertHabit(wsId, habitId, req.userId!)

    const linked = new Set(
      (await prisma.habitMetricLink.findMany({ where: { habitId }, select: { metric: true } }))
        .map((l) => l.metric)
    )

    res.json({
      metrics: WEARABLE_METRIC_KEYS.map((key) => ({
        key,
        label: WEARABLE_METRICS[key].label,
        short: WEARABLE_METRICS[key].short,
        unit: WEARABLE_METRICS[key].unit,
        direction: WEARABLE_METRICS[key].direction,
        linked: linked.has(key),
      })),
    })
  } catch (err) {
    next(err)
  }
})

// PUT /link — link a metric, or change its lag. Direction is never accepted
// from the client: whether lower or higher is better is a property of the
// metric, not a preference, and letting it be set would let the UI flip the
// meaning of a result.
router.put('/link', async (req: AuthRequest, res, next) => {
  try {
    const wsId = req.params.wsId as string
    const habitId = req.params.habitId as string
    await assertHabit(wsId, habitId, req.userId!)

    const body = LinkSchema.parse(req.body)
    const direction = WEARABLE_METRICS[body.metric].direction

    const link = await prisma.habitMetricLink.upsert({
      where: { habitId_metric: { habitId, metric: body.metric } },
      update: { lagDays: body.lagDays, direction },
      create: { habitId, metric: body.metric, lagDays: body.lagDays, direction },
    })

    res.status(201).json({ link })
  } catch (err) {
    next(err)
  }
})

// DELETE /link?metric=… — stop tracking a metric against this habit.
router.delete('/link', async (req: AuthRequest, res, next) => {
  try {
    const wsId = req.params.wsId as string
    const habitId = req.params.habitId as string
    await assertHabit(wsId, habitId, req.userId!)

    const metric = MetricSchema.parse(req.query.metric)
    await prisma.habitMetricLink.deleteMany({ where: { habitId, metric } })

    res.json({ ok: true })
  } catch (err) {
    next(err)
  }
})

export default router
