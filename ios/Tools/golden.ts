// Golden fixtures: run the web app's own TypeScript over real and randomised
// inputs, so the Swift ports can be checked against it to the decimal.
//
//   npx tsx ios/Tools/golden.ts backups/ios-export-2026-10-29.json
//
// Writes ios/OnePercentTests/Fixtures/{export,golden}.json (gitignored — they
// carry personal data). The Swift tests skip themselves when they're absent.
//
// Runs under the export's own time zone, the way the phone will.

import { readFileSync, writeFileSync, copyFileSync } from 'node:fs'
import {
  parseSchedule, resolveRange, weekProgress, isDueOn, boundsOf,
  type ScheduleBounds,
} from '../../server/src/lib/schedule.js'
import { localDate } from '../../server/src/lib/time.js'
import { progressSeries, projectFan, formatMultiplier, activeDaysPerWeek } from '../../client/src/lib/compound.js'

const TODAY = '2026-10-29'
const GRID_DAYS = 365

const exportPath = process.argv[2]
if (!exportPath) throw new Error('usage: golden.ts <export.json>')
const ex = JSON.parse(readFileSync(exportPath, 'utf8'))
const tz: string = ex.user.timezone
if (process.env.TZ !== tz) throw new Error(`run with TZ=${tz}`)

const shift = (iso: string, n: number) => {
  const d = new Date(`${iso}T12:00:00`)
  d.setDate(d.getDate() + n)
  return localDate(d, tz)
}

// --- 1. Real habits, built the way routes/momentum.ts builds them ----------

const habits = ex.workstations.flatMap((w: any) => w.habits)
const real = habits.map((h: any) => {
  const hits = new Set<string>(h.logs.filter((l: any) => l.status !== 'miss').map((l: any) => l.date))
  const sched = parseSchedule(h)
  const created = localDate(new Date(h.createdAt), tz)
  const paused = h.pausedAt ? localDate(new Date(h.pausedAt), tz) : null
  let from: string, to: string, bounds: ScheduleBounds
  if (h.archivedAt) {
    const archivedOn = localDate(new Date(h.archivedAt), tz)
    from = created; to = archivedOn
    bounds = { createdOn: created, pausedOn: paused, archivedOn }
  } else {
    from = created < shift(TODAY, -(GRID_DAYS - 1)) ? created : shift(TODAY, -(GRID_DAYS - 1))
    to = TODAY
    bounds = { createdOn: created, pausedOn: paused }
  }
  const grid = resolveRange(sched, from, to, hits, bounds).map((d) => ({
    date: d.date, count: hits.has(d.date) ? 1 : 0, scheduled: d.scheduled,
  }))
  const full = boundsOf({ createdAt: new Date(h.createdAt), pausedAt: h.pausedAt && new Date(h.pausedAt), archivedAt: h.archivedAt && new Date(h.archivedAt) }, tz)
  return {
    uid: h.id,
    grid,
    weekProgress: weekProgress(sched, TODAY, hits, full),
    dueToday: isDueOn(sched, TODAY, hits, full),
    curve: { contributions: grid, createdAt: h.createdAt, pausedAt: h.pausedAt, archivedAt: h.archivedAt },
  }
})

const series = progressSeries(real.map((r: any) => r.curve))
const live = habits.filter((h: any) => !h.archivedAt)
const weeklyActive = activeDaysPerWeek(live.map((h: any) => ({
  paused: !!h.pausedAt, scheduleType: h.scheduleType, scheduleDays: h.scheduleDays, timesPerWeek: h.timesPerWeek,
})) as any)

// --- 2. Randomised schedules — the edge cases real data hasn't hit yet -----

let seed = 42
const rand = () => {
  seed = (seed * 1664525 + 1013904223) % 4294967296
  return seed / 4294967296
}
const pick = <T,>(xs: T[]) => xs[Math.floor(rand() * xs.length)]

const random = Array.from({ length: 300 }, () => {
  const weekly = rand() < 0.5
  const scheduleType = weekly ? 'weekly' : 'days'
  const timesPerWeek = weekly ? pick([0, 1, 2, 3, 4, 5, 6, 7, 9]) : null
  const days = [0, 1, 2, 3, 4, 5, 6].filter(() => rand() < 0.5)
  const scheduleDays = pick([JSON.stringify(days), '[]', 'not json', '[0,1,2,3,4,5,6]'])
  const createdOn = shift(TODAY, -Math.floor(rand() * 120))
  const pausedOn = rand() < 0.2 ? shift(createdOn, Math.floor(rand() * 60)) : null
  const archivedOn = rand() < 0.15 ? shift(createdOn, Math.floor(rand() * 90)) : null
  const p = rand()
  const hits: string[] = []
  for (let i = 0; i < 130; i++) if (rand() < p) hits.push(shift(TODAY, -i))
  const today = shift(TODAY, -Math.floor(rand() * 14))
  const from = shift(createdOn, -Math.floor(rand() * 10))
  const input = { scheduleType, scheduleDays, timesPerWeek, createdOn, pausedOn, archivedOn, hits, today, from }
  const sched = parseSchedule(input)
  const bounds = { createdOn, pausedOn, archivedOn }
  const set = new Set(hits)
  return {
    input,
    scheduled: resolveRange(sched, from, today, set, bounds).filter((d) => d.scheduled).map((d) => d.date),
    count: resolveRange(sched, from, today, set, bounds).length,
    weekProgress: weekProgress(sched, today, set, bounds),
    dueToday: isDueOn(sched, today, set, bounds),
  }
})

// --- 3. Projection + formatting -------------------------------------------

const fans = [0, 37, 64, 100].flatMap((rhythm) => [0, 3, weeklyActive, 7].map((wa) => {
  const f = projectFan(series.progressDays, rhythm, wa)
  return { rhythm, weeklyActive: wa, current: f.current, paceEnd: f.paceEnd, oneMoreEnd: f.oneMoreEnd }
}))
const formats = [1, 1.04, 9.96, 10, 37.78, 999.4, 1000, 12_345, 999_999, 1_000_000, 3_456_789].map((v) => ({ v, s: formatMultiplier(v) }))

const golden = {
  today: TODAY,
  tz,
  real: real.map(({ curve: _c, grid, ...r }: any) => ({
    ...r,
    scheduled: grid.filter((c: any) => c.scheduled).map((c: any) => c.date),
    gridCount: grid.length,
  })),
  series: {
    progressDays: series.progressDays,
    activeDays: series.activeDays,
    first: series.actual[0]?.date ?? null,
    last: series.actual.at(-1)?.date ?? null,
    length: series.actual.length,
    lastValue: series.actual.at(-1)?.value ?? null,
    lastCeiling: series.ceiling.at(-1)?.value ?? null,
  },
  weeklyActive,
  random,
  fans,
  formats,
}

writeFileSync('ios/OnePercentTests/Fixtures/golden.json', JSON.stringify(golden))
copyFileSync(exportPath, 'ios/OnePercentTests/Fixtures/export.json')
console.log(`real habits: ${real.length}, random: ${random.length}, progressDays: ${series.progressDays.toFixed(3)} → ${formatMultiplier(series.actual.at(-1)?.value ?? 1)}`)
