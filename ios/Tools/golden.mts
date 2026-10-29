// Golden fixtures: run the web app's own TypeScript — its pure libraries AND its
// real Express route handlers — over your data, randomised schedules and
// scripted scenarios, so the Swift ports can be checked against it exactly.
//
//   TZ=UTC HARNESS_NOW=2026-10-29T03:00:00Z \
//     node --import tsx --import ./ios/Tools/harness/register.mjs \
//     ios/Tools/golden.mts backups/ios-export-2026-10-29.json
//
// TZ=UTC because that's what Cloud Functions ran in: a couple of server
// helpers only behave correctly in UTC, and production is the reference.
//
// Writes ios/OnePercentTests/Fixtures/{export,golden}.json (gitignored — they
// carry personal data). The Swift tests skip themselves when they're absent.
// export.json is the input plus a few synthetic habits that exercise paths
// real data hasn't hit yet (a phase ladder, a taper habit, a weekly quota).

import { readFileSync, writeFileSync } from 'node:fs'
import {
  parseSchedule, resolveRange, weekProgress, isDueOn, boundsOf, shiftDays,
  type ScheduleBounds,
} from '../../server/src/lib/schedule.js'
import { localDate } from '../../server/src/lib/time.js'
import { progressSeries, projectFan, formatMultiplier, activeDaysPerWeek } from '../../client/src/lib/compound.js'
import { loadExport, table } from './harness/prismaStub.cts'
import { callRoute } from './harness/routes.mts'
import habitsRouter from '../../server/src/routes/habits.js'
import logsRouter from '../../server/src/routes/logs.js'
import checkinsRouter from '../../server/src/routes/checkins.js'
import automaticityRouter from '../../server/src/routes/automaticity.js'

declare global {
  // eslint-disable-next-line no-var
  var setHarnessNow: (iso: string) => void
}

if (process.env.TZ !== 'UTC') throw new Error('run with TZ=UTC (see header)')

const TODAY = '2026-10-29'
const NOW = '2026-10-29T03:00:00.000Z'
const GRID_DAYS = 365
const shift = shiftDays

const exportPath = process.argv[2]
if (!exportPath) throw new Error('usage: golden.mts <export.json>')
const ex = JSON.parse(readFileSync(exportPath, 'utf8'))
const tz: string = ex.user.timezone
const ws = ex.workstations[0]

// --- 0. Synthetic habits -----------------------------------------------------

const synthHabit = (id: string, over: any) => ({
  id, workstationId: ws.id, goalId: null, kind: 'build', breakMode: null, avoidTrigger: null,
  replacementAction: null, frictionDevice: null, checkStyle: 'hold', checkQuestion: null,
  title: id, whyText: null, whyImageUrl: null, anchorRoutine: null, cueType: 'habit_stack',
  cueTime: null, cueLocation: null, failSafeAction: 'two minutes', celebration: null,
  temptationBundle: null, scheduleType: 'days', scheduleDays: '[0,1,2,3,4,5,6]', timesPerWeek: null,
  reminderTime: null, reminderEnabled: true, lastRemindedOn: null, nightstandRule: null,
  setbackPlans: '[]', systemFocusConfirmed: false, sectionNotes: '{}', pausedAt: null, archivedAt: null,
  updatedAt: '2026-10-01T00:00:00.000Z', checks: [], metricLinks: [], logs: [], ...over,
})
const synthPhase = (habitId: string, n: number, status: string, targetCount: number, over: any = {}) => ({
  id: `${habitId}-p${n}`, habitId, phaseNumber: n, targetText: `${habitId} step ${n}`,
  definitionOfDone: null, targetCount, dailyLimit: null, status, graduatedAt: null,
  createdAt: '2026-10-01T00:00:00.000Z', updatedAt: '2026-10-01T00:00:00.000Z', ...over,
})
const synthLog = (habitId: string, date: string, status: string, over: any = {}) => ({
  id: `${habitId}-l${date}`, habitId, phaseId: `${habitId}-p1`, date, status, quantity: null,
  goldilocks: null, missReasons: '[]', missNote: null, createdAt: `${date}T06:00:00.000Z`, ...over,
})

ws.habits.push(
  synthHabit('synth-ladder', {
    createdAt: '2026-10-10T20:00:00.000Z',
    setbackPlans: JSON.stringify([{ obstacle: 'I get home after 7pm and the kids need dinner straight away', plan: 'do it at lunch' }, { obstacle: 'Tired', plan: 'two minutes' }]),
    phases: [synthPhase('synth-ladder', 1, 'active', 3), synthPhase('synth-ladder', 2, 'locked', 4), synthPhase('synth-ladder', 3, 'locked', 2)],
  }),
  synthHabit('synth-taper', {
    kind: 'break', breakMode: 'taper', createdAt: '2026-10-01T09:00:00.000Z',
    phases: [synthPhase('synth-taper', 1, 'active', 5, { dailyLimit: 2 })],
  }),
  synthHabit('synth-weekly', {
    scheduleType: 'weekly', timesPerWeek: 3, checkStyle: 'yesno', createdAt: '2026-09-01T09:00:00.000Z',
    phases: [synthPhase('synth-weekly', 1, 'active', 30)],
    logs: [
      synthLog('synth-weekly', '2026-10-20', 'target'),
      synthLog('synth-weekly', '2026-10-21', 'failsafe'),
      synthLog('synth-weekly', '2026-10-27', 'miss', { missReasons: '["Tired"]' }),
      synthLog('synth-weekly', '2026-10-28', 'miss'),
    ],
  }),
)

const habits = ws.habits
const { userId, wsId } = loadExport(ex)
const req = (over: any = {}) => ({ userId, userTimezone: tz, ...over, params: { wsId, ...(over.params ?? {}) } })

// --- 1. Pure schedule + compound, on the export as it stands -----------------

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
  const resolved = resolveRange(sched, from, today, set, bounds)
  return {
    input,
    scheduled: resolved.filter((d) => d.scheduled).map((d) => d.date),
    count: resolved.length,
    weekProgress: weekProgress(sched, today, set, bounds),
    dueToday: isDueOn(sched, today, set, bounds),
  }
})

const fans = [0, 37, 64, 100].flatMap((rhythm) => [0, 3, weeklyActive, 7].map((wa) => {
  const f = projectFan(series.progressDays, rhythm, wa)
  return { rhythm, weeklyActive: wa, current: f.current, paceEnd: f.paceEnd, oneMoreEnd: f.oneMoreEnd }
}))
const formats = [1, 1.04, 9.96, 10, 37.78, 999.4, 1000, 12_345, 999_999, 1_000_000, 3_456_789].map((v) => ({ v, s: formatMultiplier(v) }))

// --- 2. GET /habits/today and /checkins/current across history ---------------

function todayShape(body: any) {
  return {
    date: body.date,
    weekday: body.weekday,
    habits: body.habits.map((h: any) => ({
      uid: h.id,
      phaseNumber: h.activePhase?.phaseNumber ?? null,
      completedReps: h.completedReps,
      todayStatus: h.todayLog?.status ?? null,
      automaticity: h.automaticity,
      wasPreviousMissed: h.wasPreviousMissed,
      previousMissDate: h.previousMissDate,
      previousMissNeedsReason: h.previousMissNeedsReason,
      weekStrip: h.weekStrip,
      weekProgress: h.weekProgress,
    })),
  }
}

function checkinShape(body: any) {
  return {
    weekOf: body.weekOf,
    existingStatus: body.existing?.status ?? null,
    summary: body.summary,
    unexplainedMisses: body.unexplainedMisses.map((m: any) => ({ uid: m.habitId, date: m.date, weekdayName: m.weekdayName, obstacles: m.obstacles })),
    goals: body.goals,
    priorObstacles: body.priorObstacles,
  }
}

async function snapshotViews(now: string) {
  globalThis.setHarnessNow(now)
  const t = await callRoute(habitsRouter, 'get', '/today', req())
  const c = await callRoute(checkinsRouter, 'get', '/current', req())
  return { now, today: todayShape(t.body), checkin: checkinShape(c.body) }
}

const instants: string[] = []
for (let i = 70; i >= 0; i--) {
  const day = shift(TODAY, -i)
  instants.push(`${day}T03:00:00.000Z`)          // mid-afternoon in NZ
  if (i % 6 === 0) instants.push(`${day}T11:30:00.000Z`) // just after NZ midnight
}
const views = []
for (const at of instants) views.push(await snapshotViews(at))

// --- 3. Scripted writes through the real routes -----------------------------

function habitSnapshot(habitId: string) {
  const phaseNo = (id: string | null) => table('phase').find((p) => p.id === id)?.phaseNumber ?? null
  const h = table('habit').find((x) => x.id === habitId)!
  return {
    paused: !!h.pausedAt,
    logs: table('habitLog').filter((l) => l.habitId === habitId).sort((a, b) => (a.date < b.date ? -1 : 1)).map((l) => ({
      date: l.date, status: l.status, quantity: l.quantity, goldilocks: l.goldilocks,
      missReasons: l.missReasons, missNote: l.missNote, phaseNumber: phaseNo(l.phaseId),
    })),
    phases: table('phase').filter((p) => p.habitId === habitId).sort((a, b) => a.phaseNumber - b.phaseNumber)
      .map((p) => ({ n: p.phaseNumber, status: p.status, targetCount: p.targetCount, graduated: !!p.graduatedAt })),
    checks: table('automaticityCheck').filter((c) => c.habitId === habitId).length,
  }
}

function checkinSnapshot() {
  return table('checkIn').sort((a, b) => (a.weekOf < b.weekOf ? -1 : 1)).map((c) => ({
    weekOf: c.weekOf, status: c.status, rating: c.rating, tinyVictory: c.tinyVictory,
    workingWell: c.workingWell, notWorking: c.notWorking, obstacles: c.obstacles, freeform: c.freeform,
  }))
}

const liveReal = habits.find((h: any) => !h.archivedAt && !h.pausedAt && !h.id.startsWith('synth') && h.scheduleType === 'days')
const thisMonday = '2026-10-26'

const ops: any[] = [
  { op: 'vote', habit: 'synth-ladder', status: 'target' },
  { op: 'vote', habit: 'synth-ladder', status: 'target', date: '2026-10-28' },
  { op: 'vote', habit: 'synth-ladder', status: 'failsafe', date: '2026-10-27' },
  { op: 'clear', habit: 'synth-ladder', date: '2026-10-28' },
  { op: 'vote', habit: 'synth-ladder', status: 'target', date: '2026-10-28' },
  { op: 'check', habit: 'synth-ladder', scores: [2, 2, 3, 2] },
  { op: 'check', habit: 'synth-ladder', scores: [5, 4, 4, 5] },
  { op: 'vote', habit: 'synth-ladder', status: 'target' },
  { op: 'vote', habit: 'synth-ladder', status: 'target', goldilocks: 'just_right' },
  { op: 'reason', habit: 'synth-ladder', date: '2026-10-25', reasons: ['Tired', 'No time'], note: null },
  { op: 'vote', habit: 'synth-ladder', status: 'target', date: '2026-10-15' },
  { op: 'addPhase', habit: 'synth-ladder', targetText: 'synth-ladder step 4', targetCount: 7 },
  { op: 'vote', habit: 'synth-taper', quantity: 1 },
  { op: 'vote', habit: 'synth-taper', quantity: 4, date: '2026-10-28' },
  { op: 'reason', habit: 'synth-taper', date: '2026-10-28', reasons: ['Social event', 'Tired'], note: 'party' },
  { op: 'vote', habit: 'synth-taper', status: 'target', date: '2026-10-28' },
  { op: 'reason', habit: 'synth-weekly', date: '2026-10-28', reasons: [], note: 'just forgot' },
  { op: 'vote', habit: 'synth-weekly', status: 'miss' },
  { op: 'clear', habit: 'synth-weekly' },
  { op: 'vote', habit: 'synth-weekly', status: 'target' },
  ...(liveReal ? [
    { op: 'vote', habit: liveReal.id, status: 'failsafe' },
    { op: 'pause', habit: liveReal.id, paused: true },
    { op: 'pause', habit: liveReal.id, paused: false },
  ] : []),
  { op: 'checkinSave', weekOf: thisMonday, rating: 7, tinyVictory: ' ran twice ', workingWell: '', notWorking: 'evenings',
    obstacles: [{ obstacle: ' busy week ', plan: '2-min version' }, { obstacle: '', plan: 'dropped' }, { obstacle: 'x', plan: 'y' }], freeform: null },
  { op: 'skip', weekOf: thisMonday },
  { op: 'skip', weekOf: '2026-10-19' },
]

async function runOp(o: any) {
  const params = { habitId: o.habit }
  switch (o.op) {
    case 'vote': {
      const body: any = {}
      for (const k of ['status', 'quantity', 'goldilocks', 'date']) if (o[k] !== undefined) body[k] = o[k]
      const r = await callRoute(logsRouter, 'post', '/', req({ params, body })).catch((e) => ({ status: 500, body: { error: String(e) } }))
      return r.status >= 400 ? { error: true } : { completedReps: r.body.completedReps, ready: r.body.ready }
    }
    case 'reason': {
      const r = await callRoute(logsRouter, 'post', '/reason', req({ params, body: { date: o.date, reasons: o.reasons, note: o.note } }))
      return r.status >= 400 ? { error: true } : {}
    }
    case 'clear': {
      const r = await callRoute(logsRouter, 'delete', '/', req({ params, query: o.date ? { date: o.date } : {} }))
      return r.status >= 400 ? { error: true } : {}
    }
    case 'check': {
      const r = await callRoute(automaticityRouter, 'post', '/', req({ params, body: { scores: o.scores } }))
      return r.status >= 400 ? { error: true } : { passed: r.body.passed, mean: r.body.mean, advanced: r.body.advanced, nextPhaseNumber: r.body.nextPhaseNumber }
    }
    case 'addPhase': {
      const r = await callRoute(habitsRouter, 'post', '/:id/phases', req({ params: { id: o.habit }, body: { targetText: o.targetText, targetCount: o.targetCount } }))
      return r.status >= 400 ? { error: true } : {}
    }
    case 'pause': {
      const r = await callRoute(habitsRouter, 'post', '/:id/pause', req({ params: { id: o.habit }, body: { paused: o.paused } }))
      return r.status >= 400 ? { error: true } : {}
    }
    case 'checkinSave': {
      // Shape the body exactly as CheckInCard.tsx does before it posts: the
      // op holds the raw form, the route gets what the client would send.
      const clean = (s: string | null) => (s ?? '').trim() || null
      const body = {
        weekOf: o.weekOf, rating: o.rating, tinyVictory: clean(o.tinyVictory), workingWell: clean(o.workingWell),
        notWorking: clean(o.notWorking), freeform: clean(o.freeform), aiSummary: null,
        obstacles: o.obstacles.map((x: any) => ({ obstacle: x.obstacle.trim(), plan: x.plan.trim() })).filter((x: any) => x.obstacle && x.plan),
      }
      const r = await callRoute(checkinsRouter, 'post', '/', req({ body }))
      return r.status >= 400 ? { error: true } : {}
    }
    case 'skip': {
      const r = await callRoute(checkinsRouter, 'post', '/skip', req({ body: { weekOf: o.weekOf } }))
      return r.status >= 400 ? { error: true } : {}
    }
  }
  throw new Error(`unknown op ${o.op}`)
}

globalThis.setHarnessNow(NOW)
const scenario = []
for (const o of ops) {
  const result = await runOp(o)
  scenario.push({ ...o, result, habitAfter: o.habit ? habitSnapshot(o.habit) : null, checkinsAfter: o.habit ? null : checkinSnapshot() })
}
const afterViews = [await snapshotViews(NOW), await snapshotViews('2026-10-30T03:00:00.000Z')]

// --- write -------------------------------------------------------------------

const golden = {
  today: TODAY,
  now: NOW,
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
  views,
  scenario,
  afterViews,
}

writeFileSync('ios/OnePercentTests/Fixtures/golden.json', JSON.stringify(golden))
writeFileSync('ios/OnePercentTests/Fixtures/export.json', JSON.stringify(ex))
console.log(`habits: ${real.length}, random: ${random.length}, views: ${views.length}, scenario ops: ${scenario.length}`)
console.log(`progressDays ${series.progressDays.toFixed(3)} → ${formatMultiplier(series.actual.at(-1)?.value ?? 1)}`)
