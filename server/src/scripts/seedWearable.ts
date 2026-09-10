import dotenv from 'dotenv'
dotenv.config({ path: '.env.local' }) // DATABASE_URL for local runs
dotenv.config()

import { prisma } from '../lib/prisma.js'
import { localDate } from '../lib/time.js'

// Fake-but-plausible WearableDay rows, so the Body page, the Momentum series and
// the habit-effect analysis are all buildable and reviewable before the Garmin
// collector is authenticated.
//
// Seeded rows are tagged `raw.seeded = true` and NOTHING else distinguishes them
// — they use source 'garmin' so every downstream read path is exercised exactly
// as it will be in production. --clear removes only tagged rows, so this can
// never delete real synced data.
//
//   npx tsx src/scripts/seedWearable.ts                    120 days, no planted effect
//   npx tsx src/scripts/seedWearable.ts --days 200
//   npx tsx src/scripts/seedWearable.ts --plant restingHr:-3
//   npx tsx src/scripts/seedWearable.ts --clear
//
// --plant is the important one: it shifts a metric by a known amount on the day
// after every habit rep, which is what the effect analysis must be able to find.
// Running with no --plant produces pure noise, which the same analysis must
// report as "no detectable effect". Those two runs are the real test.

const OWNER_EMAIL = process.env.LAUNCHER_OWNER_EMAIL || 'arshdeep.m@gmail.com'
const DAY_MS = 86_400_000

// Deterministic RNG — a re-run must produce the same series, or "did my change
// alter the numbers?" becomes unanswerable.
function mulberry32(seed: number) {
  return function () {
    seed |= 0
    seed = (seed + 0x6d2b79f5) | 0
    let t = Math.imul(seed ^ (seed >>> 15), 1 | seed)
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296
  }
}

const rand = mulberry32(20260910)

// Box–Muller: real physiology is bell-shaped, not uniform. Using uniform noise
// here would make the permutation test's job artificially easy.
function gauss(mean: number, sd: number): number {
  const u = Math.max(rand(), 1e-9)
  const v = rand()
  return mean + sd * Math.sqrt(-2 * Math.log(u)) * Math.cos(2 * Math.PI * v)
}

const clamp = (v: number, lo: number, hi: number) => Math.max(lo, Math.min(hi, v))

interface Args {
  days: number
  clear: boolean
  plant: { metric: string; delta: number; lag: number } | null
}

function parseArgs(argv: string[]): Args {
  const out: Args = { days: 120, clear: false, plant: null }
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i]
    if (a === '--clear') out.clear = true
    else if (a === '--days') out.days = Number(argv[++i]) || 120
    else if (a === '--plant') {
      // metric:delta[:lag] — e.g. restingHr:-3 or sleepMinutes:+25:1
      const [metric, delta, lag] = String(argv[++i] ?? '').split(':')
      if (!metric || delta === undefined) throw new Error('--plant needs metric:delta, e.g. restingHr:-3')
      out.plant = { metric, delta: Number(delta), lag: Number(lag ?? 1) }
      if (!Number.isFinite(out.plant.delta)) throw new Error(`Bad delta in --plant: ${delta}`)
    }
  }
  return out
}

async function main() {
  const args = parseArgs(process.argv.slice(2))

  const user = await prisma.user.findUnique({ where: { email: OWNER_EMAIL } })
  if (!user) throw new Error(`No user ${OWNER_EMAIL} — sign in to the app once first.`)
  const tz = user.timezone || 'Pacific/Auckland'

  if (args.clear) {
    // Tagged rows only. A raw JSON filter rather than a date range, so this
    // stays safe even if real data overlaps the seeded window.
    const { count } = await prisma.wearableDay.deleteMany({
      where: { userId: user.id, raw: { path: ['seeded'], equals: true } },
    })
    console.log(`[seed] deleted ${count} seeded day(s). Real synced rows untouched.`)
    return
  }

  // Which local dates did the user actually cast a vote on? Used only by --plant.
  const hitDates = new Set<string>()
  if (args.plant) {
    const logs = await prisma.habitLog.findMany({
      where: {
        habit: { workstation: { userId: user.id } },
        status: { in: ['target', 'failsafe'] },
      },
      select: { date: true },
    })
    for (const l of logs) hitDates.add(l.date)
    if (hitDates.size === 0) {
      console.warn('[seed] --plant given but there are no habit reps to key off. Seeding pure noise instead.')
    } else {
      console.log(`[seed] planting ${args.plant.metric} ${args.plant.delta >= 0 ? '+' : ''}${args.plant.delta} on the day after each of ${hitDates.size} reps (lag ${args.plant.lag}).`)
    }
  }

  const now = Date.now()
  const rows: any[] = []

  for (let i = args.days - 1; i >= 0; i--) {
    const at = new Date(now - i * DAY_MS)
    const date = localDate(at, tz)
    const dow = new Date(date + 'T12:00:00').getDay() // 0=Sun..6=Sat

    // A slow seasonal drift in fitness, so the series isn't stationary — a
    // trend the analysis has to survive rather than mistake for an effect.
    const drift = Math.sin((args.days - i) / 45) * 1.5

    // Weekend confound, deliberately: later nights, more steps. The effect
    // analysis must not mistake "I train on weekends" for "training works".
    const weekend = dow === 0 || dow === 6
    const fridayOrSat = dow === 5 || dow === 6

    let sleepMinutes = Math.round(clamp(gauss(fridayOrSat ? 388 : 428, 52), 240, 600))
    let restingHr = Math.round(clamp(gauss(52 + drift, 3.2), 40, 75))
    let hrvNight = Math.round(clamp(gauss(46 - drift, 9), 15, 110))
    let stressAvg = Math.round(clamp(gauss(weekend ? 28 : 36, 8), 5, 90))
    let bodyBatteryHigh = Math.round(clamp(gauss(82, 9), 30, 100))

    // Apply the planted effect to the chosen metric, `lag` days after a rep.
    if (args.plant && hitDates.size) {
      const src = localDate(new Date(at.getTime() - args.plant.lag * DAY_MS), tz)
      if (hitDates.has(src)) {
        const d = args.plant.delta
        if (args.plant.metric === 'restingHr') restingHr = Math.round(clamp(restingHr + d, 40, 75))
        else if (args.plant.metric === 'sleepMinutes') sleepMinutes = Math.round(clamp(sleepMinutes + d, 240, 600))
        else if (args.plant.metric === 'hrvNight') hrvNight = Math.round(clamp(hrvNight + d, 15, 110))
        else if (args.plant.metric === 'stressAvg') stressAvg = Math.round(clamp(stressAvg + d, 5, 90))
        else if (args.plant.metric === 'bodyBatteryHigh') bodyBatteryHigh = Math.round(clamp(bodyBatteryHigh + d, 30, 100))
        else throw new Error(`Unknown --plant metric: ${args.plant.metric}`)
      }
    }

    // Stages as a share of total sleep, roughly matching Garmin's typical split.
    const deepMinutes = Math.round(sleepMinutes * clamp(gauss(0.17, 0.035), 0.06, 0.30))
    const remMinutes = Math.round(sleepMinutes * clamp(gauss(0.22, 0.04), 0.08, 0.35))

    // Garmin's sleep score leans on duration and deep sleep; approximate it so
    // the number moves with the stages rather than floating free of them.
    const sleepScore = Math.round(
      clamp(50 + (sleepMinutes - 420) / 6 + (deepMinutes - 70) / 3 + gauss(0, 4), 1, 100)
    )

    // A handful of days with the watch off the wrist. Real series have holes and
    // every chart needs to survive them.
    const worn = rand() > 0.04

    rows.push({
      userId: user.id,
      date,
      source: 'garmin',
      sleepMinutes: worn ? sleepMinutes : null,
      deepMinutes: worn ? deepMinutes : null,
      remMinutes: worn ? remMinutes : null,
      sleepScore: worn ? sleepScore : null,
      restingHr: worn ? restingHr : null,
      hrvNight: worn ? hrvNight : null,
      bodyBatteryHigh: worn ? bodyBatteryHigh : null,
      bodyBatteryLow: worn ? Math.round(clamp(gauss(26, 11), 5, 60)) : null,
      stressAvg: worn ? stressAvg : null,
      respirationAvg: worn ? Number(clamp(gauss(14.2, 0.9), 10, 20).toFixed(1)) : null,
      steps: Math.round(clamp(gauss(weekend ? 9200 : 7600, 3100), 400, 26000)),
      activeMinutes: Math.round(clamp(gauss(weekend ? 52 : 38, 22), 0, 220)),
      raw: { seeded: true },
    })
  }

  // Upsert rather than createMany: re-running with different flags should
  // rewrite the same days, not collide on the (userId, date, source) unique.
  //
  // Chunked into transactions rather than awaited one at a time — 120 sequential
  // round-trips to the pooled Supabase instance takes over two minutes, and this
  // script exists to be re-run repeatedly while checking the effect analysis.
  const CHUNK = 40
  let written = 0
  for (let i = 0; i < rows.length; i += CHUNK) {
    const chunk = rows.slice(i, i + CHUNK)
    await prisma.$transaction(
      chunk.map((r) => {
        const { userId, date, source, ...rest } = r
        return prisma.wearableDay.upsert({
          where: { userId_date_source: { userId, date, source } },
          update: rest,
          create: r,
        })
      })
    )
    written += chunk.length
  }

  await prisma.wearableSync.upsert({
    where: { userId_source: { userId: user.id, source: 'garmin' } },
    update: { lastSyncedAt: new Date(), lastDate: rows[rows.length - 1].date, status: 'ok', error: null },
    create: {
      userId: user.id,
      source: 'garmin',
      lastSyncedAt: new Date(),
      lastDate: rows[rows.length - 1].date,
      status: 'ok',
    },
  })

  console.log(`[seed] wrote ${written} day(s), ${rows[0].date} → ${rows[rows.length - 1].date}.`)
}

main()
  .catch((e) => {
    console.error('[seed]', e instanceof Error ? e.message : e)
    process.exitCode = 1
  })
  .finally(() => prisma.$disconnect())
