import { Router } from 'express'
import { timingSafeEqual } from 'node:crypto'
import { z } from 'zod'
import { prisma } from '../lib/prisma.js'
import { requireAuth, AuthRequest } from '../middleware/auth.js'
import { localDate, lastNDates } from '../lib/time.js'
import { computeBodyInsights } from '../lib/bodyInsights.js'

// The one and only writer of wearable data.
//
// Every provider funnels through POST /ingest: the unofficial garth collector
// today, the official Garmin Health API webhooks later. They normalise to the
// same payload, so swapping the source touches nothing downstream — not the
// schema, not the Body page, not the effect analysis.
//
// Deliberately, the collector does NO timezone maths and knows NO Prisma. It
// sends what the device reported plus an ISO instant; this route decides which
// local day that belongs to, using the same helpers habit logging uses.

const router = Router()

const DAY_MS = 86_400_000
// A backfill sends a year at most in one call; anything larger is a bug or abuse.
const MAX_DAYS = 400
const MAX_ACTIVITIES = 500

// ── Ingest (machine-to-machine) ──────────────────────────────────────────────

const DaySchema = z.object({
  date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
  sleepMinutes: z.number().int().min(0).max(1440).nullish(),
  deepMinutes: z.number().int().min(0).max(1440).nullish(),
  remMinutes: z.number().int().min(0).max(1440).nullish(),
  sleepScore: z.number().int().min(0).max(100).nullish(),
  restingHr: z.number().int().min(20).max(150).nullish(),
  hrvNight: z.number().int().min(0).max(300).nullish(),
  bodyBatteryHigh: z.number().int().min(0).max(100).nullish(),
  bodyBatteryLow: z.number().int().min(0).max(100).nullish(),
  stressAvg: z.number().int().min(0).max(100).nullish(),
  respirationAvg: z.number().min(0).max(60).nullish(),
  steps: z.number().int().min(0).max(200_000).nullish(),
  activeMinutes: z.number().int().min(0).max(1440).nullish(),
  sedentarySeconds: z.number().int().min(0).max(86_400).nullish(),
  // Local minutes since midnight (0-1439).
  sleepStartMin: z.number().int().min(0).max(1439).nullish(),
  sleepEndMin: z.number().int().min(0).max(1439).nullish(),
  avgSleepStress: z.number().min(0).max(100).nullish(),
  awakeCount: z.number().int().min(0).max(200).nullish(),
  bodyBatteryAtWake: z.number().int().min(0).max(100).nullish(),
  lowStressSeconds: z.number().int().min(0).max(86_400).nullish(),
  highStressSeconds: z.number().int().min(0).max(86_400).nullish(),
  minHeartRate: z.number().int().min(20).max(150).nullish(),
  maxHeartRate: z.number().int().min(40).max(250).nullish(),
  avgWakingRespiration: z.number().min(0).max(60).nullish(),
  raw: z.record(z.any()).nullish(),
})

const ActivitySchema = z.object({
  externalId: z.string().min(1).max(120),
  type: z.string().min(1).max(60),
  // An ISO instant. The local date it belongs to is derived here, never sent.
  startedAt: z.string().datetime({ offset: true }),
  durationSec: z.number().int().min(0).max(86_400 * 7),
  distanceM: z.number().min(0).max(1_000_000).nullish(),
  avgHr: z.number().int().min(20).max(250).nullish(),
  raw: z.record(z.any()).nullish(),
})

// One endpoint's untouched response for one day. Capped generously: the
// largest real payload seen in the survey was ~124 KB (a night of sleep with
// its movement and stage series).
const RawSchema = z.object({
  date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
  domain: z.string().min(1).max(40),
  payload: z.unknown(),
})

const ActivityRawSchema = z.object({
  externalId: z.string().min(1).max(120),
  domain: z.string().min(1).max(40),
  payload: z.unknown(),
})

const IngestSchema = z.object({
  email: z.string().email(),
  source: z.string().min(1).max(40).default('garmin'),
  days: z.array(DaySchema).max(MAX_DAYS).default([]),
  activities: z.array(ActivitySchema).max(MAX_ACTIVITIES).default([]),
  // Verbatim endpoint responses — see the WearableRaw model for why.
  raws: z.array(RawSchema).max(2000).default([]),
  activityRaws: z.array(ActivityRawSchema).max(400).default([]),
  // Set by a collector that failed partway: record it rather than reporting a
  // clean sync. The Settings card surfaces this verbatim.
  error: z.string().max(500).nullish(),
})

// Constant-time comparison. timingSafeEqual throws on a length mismatch, so the
// lengths are checked first and a dummy comparison is still run — a wrong-length
// guess should not return measurably faster than a wrong-value one.
function secretMatches(provided: string | undefined, expected: string): boolean {
  if (!provided) return false
  const a = Buffer.from(provided)
  const b = Buffer.from(expected)
  if (a.length !== b.length) {
    // Still burn a comparison so a wrong-length guess isn't measurably faster.
    timingSafeEqual(b, b)
    return false
  }
  return timingSafeEqual(a, b)
}

// Only the fields the caller actually sent. Prisma skips `undefined`, so an
// absent metric leaves the stored value alone instead of erasing it — a resync
// that arrives before Garmin has computed last night's sleep must not blank out
// a good earlier reading. `null` is treated the same as absent for that reason;
// a genuine correction sends the corrected number.
type Defined<T> = { [K in keyof T]?: Exclude<T[K], null | undefined> }

function definedFields<T extends Record<string, unknown>>(obj: T): Defined<T> {
  const out: Record<string, unknown> = {}
  for (const [k, v] of Object.entries(obj)) {
    if (v !== undefined && v !== null) out[k] = v
  }
  return out as Defined<T>
}

// POST /ingest — shared-secret, not requireAuth: this is called by the collector,
// which has no Firebase identity. Never mount it behind the user session.
router.post('/ingest', async (req, res, next) => {
  try {
    const expected = process.env.WEARABLE_INGEST_SECRET
    if (!expected) {
      // Fail loudly rather than accepting anonymous writes to health data.
      res.status(503).json({ error: 'Ingest is not configured on this server.' })
      return
    }
    const provided = req.headers['x-ingest-secret']
    if (!secretMatches(typeof provided === 'string' ? provided : undefined, expected)) {
      res.status(401).json({ error: 'Bad ingest secret' })
      return
    }

    const body = IngestSchema.parse(req.body)

    const user = await prisma.user.findUnique({
      where: { email: body.email },
      select: { id: true, timezone: true },
    })
    if (!user) { res.status(404).json({ error: 'No such user' }); return }
    const tz = user.timezone || 'Pacific/Auckland'

    // A collector that failed records the failure and writes nothing else, so
    // "last sync was fine" is never shown over a broken session.
    if (body.error) {
      await prisma.wearableSync.upsert({
        where: { userId_source: { userId: user.id, source: body.source } },
        update: { status: 'error', error: body.error },
        create: { userId: user.id, source: body.source, status: 'error', error: body.error },
      })
      res.json({ ok: false, recorded: 'error', days: 0, activities: 0 })
      return
    }

    // Chunked transactions — a year-long backfill one await at a time takes
    // minutes against a pooled Postgres.
    const CHUNK = 50
    let dayCount = 0
    for (let i = 0; i < body.days.length; i += CHUNK) {
      const chunk = body.days.slice(i, i + CHUNK)
      await prisma.$transaction(
        chunk.map((d) => {
          const { date, ...metrics } = d
          const fields = definedFields(metrics)
          return prisma.wearableDay.upsert({
            where: { userId_date_source: { userId: user.id, date, source: body.source } },
            update: { ...fields, fetchedAt: new Date() },
            create: { userId: user.id, date, source: body.source, ...fields },
          })
        })
      )
      dayCount += chunk.length
    }

    let activityCount = 0
    for (let i = 0; i < body.activities.length; i += CHUNK) {
      const chunk = body.activities.slice(i, i + CHUNK)
      await prisma.$transaction(
        chunk.map((a) => {
          const startedAt = new Date(a.startedAt)
          const common = {
            userId: user.id,
            type: a.type.toLowerCase(),
            startedAt,
            // Derived here, not by the collector — one place owns local dates.
            localDate: localDate(startedAt, tz),
            durationSec: a.durationSec,
            ...definedFields({ distanceM: a.distanceM, avgHr: a.avgHr, raw: a.raw }),
          }
          return prisma.wearableActivity.upsert({
            where: { source_externalId: { source: body.source, externalId: a.externalId } },
            update: common,
            create: { ...common, source: body.source, externalId: a.externalId },
          })
        })
      )
      activityCount += chunk.length
    }

    // Verbatim payloads. Never lets a raw-capture failure lose the curated
    // day rows that were already written above.
    let rawCount = 0
    try {
      for (let i = 0; i < body.raws.length; i += 25) {
        const chunk = body.raws.slice(i, i + 25)
        await prisma.$transaction(chunk.map((r) => {
          const bytes = JSON.stringify(r.payload ?? null).length
          const data = { payload: (r.payload ?? {}) as object, bytes, fetchedAt: new Date() }
          return prisma.wearableRaw.upsert({
            where: { userId_date_domain_source: { userId: user.id, date: r.date, domain: r.domain, source: body.source } },
            update: data,
            create: { userId: user.id, date: r.date, domain: r.domain, source: body.source, ...data },
          })
        }))
        rawCount += chunk.length
      }
      for (let i = 0; i < body.activityRaws.length; i += 10) {
        const chunk = body.activityRaws.slice(i, i + 10)
        await prisma.$transaction(chunk.map((r) => {
          const bytes = JSON.stringify(r.payload ?? null).length
          const data = { userId: user.id, payload: (r.payload ?? {}) as object, bytes, fetchedAt: new Date() }
          return prisma.wearableActivityRaw.upsert({
            where: { source_externalId_domain: { source: body.source, externalId: r.externalId, domain: r.domain } },
            update: data,
            create: { source: body.source, externalId: r.externalId, domain: r.domain, ...data },
          })
        }))
        rawCount += chunk.length
      }
    } catch (e) {
      console.error('[ingest] raw capture failed', e)
    }

    // Latest date we now hold — where the next incremental sync resumes.
    const latest = body.days.length
      ? body.days.map((d) => d.date).sort().at(-1)!
      : undefined

    await prisma.wearableSync.upsert({
      where: { userId_source: { userId: user.id, source: body.source } },
      update: { lastSyncedAt: new Date(), status: 'ok', error: null, ...(latest ? { lastDate: latest } : {}) },
      create: {
        userId: user.id,
        source: body.source,
        lastSyncedAt: new Date(),
        lastDate: latest ?? null,
        status: 'ok',
      },
    })

    res.json({ ok: true, days: dayCount, activities: activityCount, raws: rawCount })
  } catch (err) {
    next(err)
  }
})

// GET /ingest/state?email=… — where the collector should resume from. Uses the
// same shared secret as /ingest: the collector has no user session, and it
// needs this before it can decide which days to ask Garmin for.
router.get('/ingest/state', async (req, res, next) => {
  try {
    const expected = process.env.WEARABLE_INGEST_SECRET
    if (!expected) { res.status(503).json({ error: 'Ingest is not configured on this server.' }); return }
    const provided = req.headers['x-ingest-secret']
    if (!secretMatches(typeof provided === 'string' ? provided : undefined, expected)) {
      res.status(401).json({ error: 'Bad ingest secret' })
      return
    }

    const email = z.string().email().parse(req.query.email)
    const user = await prisma.user.findUnique({ where: { email }, select: { id: true, timezone: true } })
    if (!user) { res.status(404).json({ error: 'No such user' }); return }

    // Every date held inside the backfill window, not just the extremes.
    //
    // The collector used to get only the oldest date and walk backwards from
    // it, which silently assumed the history was contiguous. It isn't: a failed
    // run, or a day removed by hand, leaves a hole in the middle that a
    // backwards walk never returns to. Handing over the actual set lets the
    // collector ask for what is genuinely missing.
    const windowDays = Math.min(Number(req.query.window) || 730, 1100)
    const from = localDate(new Date(Date.now() - windowDays * DAY_MS), user.timezone || 'Pacific/Auckland')

    const rows = await prisma.wearableDay.findMany({
      where: { userId: user.id, date: { gte: from } },
      select: { date: true },
      orderBy: { date: 'asc' },
    })
    const held = rows.map((r) => r.date)

    // Dates whose verbatim capture already looks complete. The collector walks
    // these separately from the curated days: raw capture is ~22 requests a
    // day against 3, so tying them together would slow the fast one to the
    // pace of the slow one.
    const rawRows = await prisma.wearableRaw.groupBy({
      by: ['date'],
      where: { userId: user.id, date: { gte: from } },
      _count: { domain: true },
    })
    const RAW_COMPLETE_AT = 12 // most days return ~20 domains; allow for quiet ones
    const rawHeld = rawRows.filter((r) => r._count.domain >= RAW_COMPLETE_AT).map((r) => r.date)

    // Activities whose detail streams we already hold. Without this the
    // collector re-downloads a ~300 KB stream per activity on every run.
    const actRaw = await prisma.wearableActivityRaw.findMany({
      where: { userId: user.id, domain: 'details' },
      select: { externalId: true },
    })

    res.json({
      timezone: user.timezone,
      windowFrom: from,
      held,
      rawHeld,
      activityRawHeld: actRaw.map((a) => a.externalId),
      firstDate: held[0] ?? null,
      lastDate: held[held.length - 1] ?? null,
    })
  } catch (err) {
    next(err)
  }
})

// ── Read paths (user session) ────────────────────────────────────────────────

router.use(requireAuth)

const DAY_FIELDS = {
  date: true,
  sleepStartMin: true,
  sleepEndMin: true,
  bodyBatteryAtWake: true,
  avgSleepStress: true,
  awakeCount: true,
  sleepMinutes: true,
  deepMinutes: true,
  remMinutes: true,
  sleepScore: true,
  restingHr: true,
  hrvNight: true,
  bodyBatteryHigh: true,
  bodyBatteryLow: true,
  stressAvg: true,
  respirationAvg: true,
  steps: true,
  activeMinutes: true,
} as const

const RangeSchema = z.object({
  from: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional(),
  to: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional(),
  days: z.coerce.number().int().min(1).max(730).optional(),
})

// GET /days?from&to  |  ?days=30
// The Body page's only data source. Returns rows as stored — sparse, with gaps
// where the watch wasn't worn. The client draws the gaps; it never fills them.
router.get('/days', async (req: AuthRequest, res, next) => {
  try {
    const q = RangeSchema.parse(req.query)
    const tz = req.userTimezone ?? 'Pacific/Auckland'

    const to = q.to ?? localDate(new Date(), tz)
    const from = q.from ?? (
      q.days
        ? localDate(new Date(Date.now() - (q.days - 1) * DAY_MS), tz)
        : lastNDates(new Date(), tz, 30)[0]
    )

    const days = await prisma.wearableDay.findMany({
      where: { userId: req.userId!, date: { gte: from, lte: to } },
      select: DAY_FIELDS,
      orderBy: { date: 'asc' },
    })

    res.json({ from, to, days })
  } catch (err) {
    next(err)
  }
})

// POST /sync-now — ask the collector to run immediately.
//
// A proxy, deliberately. The collector's trigger is guarded by the ingest
// secret, and that secret must never reach the browser; the server holds it and
// forwards on behalf of the signed-in user. No-ops with a clear message when
// the trigger URL isn't configured, per the house rule for optional
// integrations (cf. launcherSnapshot.ts).
router.post('/sync-now', async (req: AuthRequest, res, next) => {
  try {
    const url = process.env.GARMIN_SYNC_URL
    const secret = process.env.WEARABLE_INGEST_SECRET
    if (!url || !secret) {
      res.status(503).json({ error: 'Manual sync is not configured on this server.' })
      return
    }

    // The collector walks day by day through Garmin; a backfill bite takes a
    // couple of minutes. Longer than a normal request, well inside the
    // function's own timeout.
    const controller = new AbortController()
    const timer = setTimeout(() => controller.abort(), 300_000)
    try {
      const r = await fetch(url, {
        method: 'POST',
        headers: { 'x-ingest-secret': secret },
        signal: controller.signal,
      })
      const text = await r.text()
      res.status(r.ok ? 200 : 502).json({ ok: r.ok, detail: text.slice(0, 300) })
    } finally {
      clearTimeout(timer)
    }
  } catch (err) {
    next(err)
  }
})

// GET /status — for the Settings card and the Body page's empty state.
router.get('/status', async (req: AuthRequest, res, next) => {
  try {
    const [sync, total, earliest] = await Promise.all([
      prisma.wearableSync.findFirst({ where: { userId: req.userId! } }),
      prisma.wearableDay.count({ where: { userId: req.userId! } }),
      prisma.wearableDay.findFirst({
        where: { userId: req.userId! },
        select: { date: true },
        orderBy: { date: 'asc' },
      }),
    ])

    res.json({
      connected: total > 0,
      totalDays: total,
      firstDate: earliest?.date ?? null,
      lastSyncedAt: sync?.lastSyncedAt ?? null,
      lastDate: sync?.lastDate ?? null,
      status: sync?.status ?? null,
      error: sync?.error ?? null,
    })
  } catch (err) {
    next(err)
  }
})

// GET /insights — what Garmin has the data for but doesn't tell you.
//
// Deliberately independent of habits: the habit-linked analysis is only as
// good as how long the person has been logging habits, and that is the slow
// ingredient. These findings need only the wearable history.
router.get('/insights', async (req: AuthRequest, res, next) => {
  try {
    const tz = req.userTimezone ?? 'Pacific/Auckland'
    res.json(await computeBodyInsights(req.userId!, tz))
  } catch (err) {
    next(err)
  }
})

// GET /capture — what has actually been captured, and how much of it.
//
// The verbatim store is invisible by design: nothing renders it directly. This
// makes its progress and its cost legible, so "is the backfill still running?"
// and "how big is this getting?" are answerable without a database client.
router.get('/capture', async (req: AuthRequest, res, next) => {
  try {
    const [byDomain, totals, dayRange, activityRaw] = await Promise.all([
      prisma.wearableRaw.groupBy({
        by: ['domain'],
        where: { userId: req.userId! },
        _count: { _all: true },
        _sum: { bytes: true },
      }),
      prisma.wearableRaw.aggregate({
        where: { userId: req.userId! },
        _count: { _all: true },
        _sum: { bytes: true },
      }),
      Promise.all([
        prisma.wearableRaw.findFirst({ where: { userId: req.userId! }, select: { date: true }, orderBy: { date: 'asc' } }),
        prisma.wearableRaw.findFirst({ where: { userId: req.userId! }, select: { date: true }, orderBy: { date: 'desc' } }),
      ]),
      prisma.wearableActivityRaw.aggregate({
        where: { userId: req.userId! },
        _count: { _all: true },
        _sum: { bytes: true },
      }),
    ])

    // How many distinct days have any capture at all.
    const distinct = await prisma.wearableRaw.findMany({
      where: { userId: req.userId! },
      select: { date: true },
      distinct: ['date'],
    })

    res.json({
      domains: byDomain
        .map((d) => ({ domain: d.domain, days: d._count._all, bytes: d._sum.bytes ?? 0 }))
        .sort((a, b) => b.bytes - a.bytes),
      totalRows: totals._count._all,
      totalBytes: totals._sum.bytes ?? 0,
      daysCaptured: distinct.length,
      firstDate: dayRange[0]?.date ?? null,
      lastDate: dayRange[1]?.date ?? null,
      activityRows: activityRaw._count._all,
      activityBytes: activityRaw._sum.bytes ?? 0,
    })
  } catch (err) {
    next(err)
  }
})

export default router
