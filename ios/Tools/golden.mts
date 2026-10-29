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
import momentumRouter from '../../server/src/routes/momentum.js'
import compassRouter from '../../server/src/routes/compass.js'
import aiRouter from '../../server/src/routes/ai.js'
import { calls as geminiCalls } from './harness/geminiStub.cts'
import { scoreConcreteness } from '../../client/src/lib/concreteness.js'
import { computeHabitEffects, computeMissPredictors } from '../../server/src/lib/habitEffect.js'
import { computeBodyInsights } from '../../server/src/lib/bodyInsights.js'
import { permutationTest, benjaminiHochberg, circularStats, circularSdMinutes, median } from '../../server/src/lib/stats.js'

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

// Body links on real habits, so the effect analysis and the insights' wearable
// block have something to test.
const meditation = ws.habits.find((h: any) => /meditation/i.test(h.title) && !h.archivedAt && !h.pausedAt)
const cricket = ws.habits.find((h: any) => /cricket/i.test(h.title) && !h.archivedAt)
const link = (h: any, metric: string, lagDays: number, i: number) => ({
  id: `link-${h.id}-${metric}`, habitId: h.id, metric, direction: metric === 'restingHr' || metric === 'stressAvg' ? 'lower_better' : 'higher_better',
  lagDays, createdAt: `2026-09-01T00:00:0${i}.000Z`,
})
if (meditation) meditation.metricLinks = [link(meditation, 'restingHr', 1, 1), link(meditation, 'sleepMinutes', 0, 2), link(meditation, 'hrvNight', 1, 3)]
if (cricket) cricket.metricLinks = [link(cricket, 'bodyBatteryHigh', 1, 4), link(cricket, 'stressAvg', 0, 5)]

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

// --- 2b. GET /momentum, plus the client's curve maths on its output ----------

function momentumShape(m: any) {
  const series = progressSeries([...m.trajectory, ...m.archived])
  const weekly = activeDaysPerWeek(m.trajectory)
  const fan = projectFan(series.progressDays, m.consistency.rhythm, weekly, 26)
  return {
    totalVotes: m.totalVotes,
    totalRecoveries: m.totalRecoveries,
    consistency: m.consistency,
    // Keyed by title: habits created during the scenario get different ids on
    // each side, but the same title.
    automaticity: m.automaticity.map((a: any) => ({ uid: m.trajectory.find((t: any) => t.habitId === a.habitId)?.title, mean: a.mean, passed: a.passed })),
    weeklyRatings: m.weeklyRatings,
    ratio: m.ratio,
    contributions: m.contributions,
    habitCount: m.habitCount,
    topObstacle: m.topObstacle,
    trajectory: m.trajectory.map((t: any) => ({
      uid: t.title,
      consistency: t.consistency,
      contributions: t.contributions.map((c: any) => ({
        date: c.date, count: c.count, wasSavedMiss: c.wasSavedMiss, status: c.status ?? null,
        scheduled: c.scheduled, missReasons: c.missReasons ?? null,
      })),
      topObstacles: t.topObstacles,
      missPattern: t.missPattern,
      setbackObstacles: t.setbackObstacles,
      phases: t.phases.map((p: any) => ({ n: p.phaseNumber, status: p.status, targetCount: p.targetCount, graduated: !!p.graduatedAt })),
    })),
    archivedCount: m.archived.length,
    curve: {
      progressDays: series.progressDays, activeDays: series.activeDays, length: series.actual.length,
      first: series.actual[0]?.date ?? null, last: series.actual.at(-1)?.date ?? null,
      lastValue: series.actual.at(-1)?.value ?? null, lastCeiling: series.ceiling.at(-1)?.value ?? null,
      weeklyActive: weekly, paceEnd: fan.paceEnd, oneMoreEnd: fan.oneMoreEnd,
    },
  }
}

async function momentumAt(now: string) {
  globalThis.setHarnessNow(now)
  const r = await callRoute(momentumRouter, 'get', '/', req())
  return { now, momentum: momentumShape(r.body) }
}

const momentumViews = []
for (let i = 77; i >= 0; i -= 7) momentumViews.push(await momentumAt(`${shift(TODAY, -i)}T03:00:00.000Z`))
momentumViews.push(await momentumAt(`${TODAY}T11:30:00.000Z`))

// --- 2c. The body: stats, insights and habit effects --------------------------

seed = 7
const statsCases = Array.from({ length: 40 }, (_, i) => {
  const n1 = 8 + Math.floor(rand() * 30), n2 = 8 + Math.floor(rand() * 30)
  const shiftBy = i % 3 === 0 ? 0 : rand() * 6
  const a = Array.from({ length: n1 }, () => Math.round((50 + rand() * 20 + shiftBy) * 10) / 10)
  const b = Array.from({ length: n2 }, () => Math.round((50 + rand() * 20) * 10) / 10)
  const iterations = i % 2 ? 2500 : 10000
  return { a, b, seed: 12345 + i, iterations, p: permutationTest(a, b, 12345 + i, iterations), medA: median(a), medB: median(b) }
})
const bh = { p: statsCases.map((c) => c.p), q: benjaminiHochberg(statsCases.map((c) => c.p)) }
const circ = [[0.95, 0.97, 0.02, 0.01], [0.3, 0.31, 0.29, 0.32, 0.5], [0.1, 0.6, 0.35, 0.85]].map((f) => {
  const c = circularStats(f)!
  return { f, mean: c.meanFraction, resultant: c.resultant, sd: circularSdMinutes(c.resultant) }
})

async function bodyAt(now: string) {
  globalThis.setHarnessNow(now)
  const effects: any = {}
  for (const h of [meditation, cricket].filter(Boolean)) {
    effects[h.title] = await computeHabitEffects(h.id, userId, h.metricLinks.map((l: any) => ({ metric: l.metric, lagDays: l.lagDays })), tz)
  }
  return {
    now,
    insights: await computeBodyInsights(userId, tz),
    predictors: await computeMissPredictors(wsId, userId, tz),
    effects,
  }
}
const body = [await bodyAt('2026-09-20T03:00:00.000Z'), await bodyAt(NOW)]

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

// --- 3b. Designing habits + the Compass, driven like the web client --------
//
// The Architect page turns its form into route calls (create, or patch +
// phase edits). `formOf` / `submitDraft` replay that exactly, so an op holds
// the FORM the person filled in and both sides start from the same input.

const emptyForm = {
  kind: 'build', goalTitle: '', breakMode: 'abstain', checkStyle: 'hold', checkQuestion: '', avoidTrigger: '',
  replacementAction: '', frictionDevice: '', title: '', whyText: '', cueType: 'habit_stack', anchorRoutine: '',
  cueTime: '', cueLocation: '', failSafeAction: '', celebration: '', temptationBundle: '', targetText: '',
  definitionOfDone: '', targetCount: 14, dailyLimit: 2, reminderTime: '', reminderEnabled: true, nightstandRule: '',
  systemFocusConfirmed: false, scheduleType: 'days', days: [0, 1, 2, 3, 4, 5, 6], timesPerWeek: 3,
  setbacks: [] as any[], sectionNotes: {} as any, extraPhases: [] as any[],
}

const goalIdByTitle = (t: string) => (t ? table('goal').find((g) => g.title === t)?.id ?? null : null)
const habitByTitle = (t: string) => table('habit').find((h) => h.title === t)!

function formOf(h: any) {
  const phases = table('phase').filter((p) => p.habitId === h.id).sort((a, b) => a.phaseNumber - b.phaseNumber)
  const phase = phases.find((p) => p.status === 'active' || p.status === 'ready') ?? null
  return {
    form: {
      kind: h.kind, goalTitle: h.goalId ? table('goal').find((g) => g.id === h.goalId)?.title ?? '' : '',
      breakMode: h.breakMode ?? 'abstain', checkStyle: h.checkStyle ?? 'hold', checkQuestion: h.checkQuestion ?? '',
      avoidTrigger: h.avoidTrigger ?? '', replacementAction: h.replacementAction ?? '', frictionDevice: h.frictionDevice ?? '',
      title: h.title, whyText: h.whyText ?? '', cueType: h.cueType, anchorRoutine: h.anchorRoutine ?? '', cueTime: h.cueTime ?? '',
      cueLocation: h.cueLocation ?? '', failSafeAction: h.failSafeAction, celebration: h.celebration ?? '',
      temptationBundle: h.temptationBundle ?? '', targetText: phase?.targetText ?? '', definitionOfDone: phase?.definitionOfDone ?? '',
      targetCount: phase?.targetCount ?? 14, dailyLimit: phase?.dailyLimit ?? 2, reminderTime: h.reminderTime ?? '',
      reminderEnabled: h.reminderEnabled ?? true, nightstandRule: h.nightstandRule ?? '', systemFocusConfirmed: h.systemFocusConfirmed ?? false,
      scheduleType: h.scheduleType === 'weekly' ? 'weekly' : 'days', days: (() => { try { return JSON.parse(h.scheduleDays) } catch { return [0, 1, 2, 3, 4, 5, 6] } })(),
      timesPerWeek: h.timesPerWeek ?? 3, setbacks: (() => { try { return JSON.parse(h.setbackPlans) } catch { return [] } })(),
      sectionNotes: (() => { try { return JSON.parse(h.sectionNotes) } catch { return {} } })(),
      extraPhases: phases.filter((p) => p.status === 'locked').map((p) => ({ id: p.id, targetText: p.targetText, definitionOfDone: p.definitionOfDone ?? '', targetCount: p.targetCount, dailyLimit: p.dailyLimit ?? 0 })),
    },
    editingPhaseId: phase?.id ?? null,
  }
}

const cleanSetbacks = (rows: any[]) => rows.map((r) => ({ obstacle: r.obstacle.trim(), plan: r.plan.trim() })).filter((r) => r.obstacle && r.plan)
const cleanNotes = (n: any) => { const o: any = {}; for (const k of ['cue', 'craving', 'response', 'reward', 'setbacks']) { const v = n[k]?.trim(); if (v) o[k] = v } return o }

function payloadOf(form: any) {
  const breaking = form.kind === 'break', taper = breaking && form.breakMode === 'taper'
  const reminder = !form.reminderEnabled ? { reminderEnabled: false, reminderTime: null }
    : { reminderEnabled: true, reminderTime: (form.reminderTime.trim() || (form.cueType === 'time' ? form.cueTime.trim() : '')) || null }
  return {
    goalId: goalIdByTitle(form.goalTitle),
    breakMode: breaking ? form.breakMode : null,
    checkStyle: taper ? 'hold' : form.checkStyle,
    checkQuestion: form.checkStyle === 'yesno' && !taper ? form.checkQuestion.trim() || null : null,
    avoidTrigger: breaking ? form.avoidTrigger.trim() || null : null,
    replacementAction: breaking ? form.replacementAction.trim() || null : null,
    frictionDevice: breaking ? form.frictionDevice.trim() || null : null,
    title: form.title.trim(), whyText: form.whyText.trim() || null, whyImageUrl: null, cueType: form.cueType,
    anchorRoutine: form.cueType === 'habit_stack' ? form.anchorRoutine.trim() : null,
    cueTime: form.cueType === 'time' ? form.cueTime.trim() : null,
    cueLocation: form.cueType === 'location' ? form.cueLocation.trim() : null,
    failSafeAction: form.failSafeAction.trim(), celebration: form.celebration.trim() || null,
    temptationBundle: form.temptationBundle.trim() || null,
    ...(form.scheduleType === 'weekly' ? { scheduleType: 'weekly', timesPerWeek: form.timesPerWeek } : { scheduleType: 'days', scheduleDays: form.days, timesPerWeek: null }),
    ...reminder,
    nightstandRule: form.nightstandRule.trim() || null, setbackPlans: cleanSetbacks(form.setbacks),
    systemFocusConfirmed: form.systemFocusConfirmed, sectionNotes: cleanNotes(form.sectionNotes),
  }
}

async function designOp(o: any) {
  const taperOf = (f: any) => f.kind === 'break' && f.breakMode === 'taper'
  if (o.op === 'createHabit') {
    const form = { ...emptyForm, ...o.form }
    const taper = taperOf(form)
    const body = { kind: form.kind, ...payloadOf(form), phases: [
      { targetText: form.targetText.trim(), definitionOfDone: form.definitionOfDone.trim() || null, targetCount: form.targetCount, dailyLimit: taper ? form.dailyLimit : null },
      ...form.extraPhases.map((p: any) => ({ targetText: p.targetText.trim(), definitionOfDone: p.definitionOfDone.trim() || null, targetCount: p.targetCount, dailyLimit: taper ? p.dailyLimit : null })),
    ] }
    const r = await callRoute(habitsRouter, 'post', '/', req({ body })).catch((e) => { console.error('createHabit failed:', e?.message ?? e); return { status: 500, body: null } })
    return r.status >= 400 ? { error: true } : {}
  }
  if (o.op === 'editHabit') {
    const h = habitByTitle(o.title)
    const { form, editingPhaseId } = formOf(h)
    Object.assign(form, o.patch ?? {})
    const removed = (o.removeExtra ?? []).map((i: number) => form.extraPhases[i]?.id).filter(Boolean)
    form.extraPhases = form.extraPhases.filter((_: any, i: number) => !(o.removeExtra ?? []).includes(i)).concat(o.appendExtra ?? [])
    const taper = taperOf(form)
    const r = await callRoute(habitsRouter, 'patch', '/:id', req({ params: { id: h.id }, body: payloadOf(form) })).catch(() => ({ status: 500 }))
    if (r.status >= 400) return { error: true }
    if (editingPhaseId) await callRoute(habitsRouter, 'patch', '/:id/phases/:phaseId', req({ params: { id: h.id, phaseId: editingPhaseId }, body: {
      targetText: form.targetText.trim(), definitionOfDone: form.definitionOfDone.trim() || null, targetCount: form.targetCount, dailyLimit: taper ? form.dailyLimit : null } }))
    for (const id of removed) await callRoute(habitsRouter, 'delete', '/:id/phases/:phaseId', req({ params: { id: h.id, phaseId: id } }))
    for (const p of form.extraPhases) {
      const body = { targetText: p.targetText.trim(), definitionOfDone: p.definitionOfDone.trim() || null, targetCount: p.targetCount, dailyLimit: taper ? p.dailyLimit : null }
      if (p.id) await callRoute(habitsRouter, 'patch', '/:id/phases/:phaseId', req({ params: { id: h.id, phaseId: p.id }, body }))
      else await callRoute(habitsRouter, 'post', '/:id/phases', req({ params: { id: h.id }, body }))
    }
    return {}
  }
  if (o.op === 'archiveHabit') {
    await callRoute(habitsRouter, 'delete', '/:id', req({ params: { id: habitByTitle(o.title).id } }))
    return {}
  }
  if (o.op === 'compassSave') { await callRoute(compassRouter, 'put', '/draft', req({ body: { draft: o.draft } })); return {} }
  if (o.op === 'compassSnapshot') { await callRoute(compassRouter, 'post', '/snapshots', req({ body: { label: o.label } })); return {} }
  if (o.op === 'compassRestoreLatest') {
    const latest = [...table('compassSnapshot')].sort((a, b) => (a.createdAt < b.createdAt ? 1 : -1))[0]
    await callRoute(compassRouter, 'post', '/snapshots/:id/restore', req({ params: { id: latest.id } }))
    return {}
  }
  if (o.op === 'compassReset') { await callRoute(compassRouter, 'post', '/reset', req()); return {} }
  throw new Error(`unknown design op ${o.op}`)
}

function designSnapshot() {
  const parse = (s: string) => { try { return JSON.parse(s) } catch { return s } }
  const habits = table('habit').filter((h) => h.id.startsWith('stub')).sort((a, b) => (a.title < b.title ? -1 : 1)).map((h) => ({
    kind: h.kind, breakMode: h.breakMode, checkStyle: h.checkStyle, checkQuestion: h.checkQuestion, avoidTrigger: h.avoidTrigger,
    replacementAction: h.replacementAction, frictionDevice: h.frictionDevice, title: h.title, whyText: h.whyText, cueType: h.cueType,
    anchorRoutine: h.anchorRoutine, cueTime: h.cueTime, cueLocation: h.cueLocation, failSafeAction: h.failSafeAction,
    celebration: h.celebration, temptationBundle: h.temptationBundle, scheduleType: h.scheduleType, scheduleDays: parse(h.scheduleDays),
    timesPerWeek: h.timesPerWeek, reminderTime: h.reminderTime, reminderEnabled: h.reminderEnabled, nightstandRule: h.nightstandRule,
    setbackPlans: parse(h.setbackPlans), systemFocusConfirmed: h.systemFocusConfirmed, sectionNotes: parse(h.sectionNotes),
    goalTitle: h.goalId ? table('goal').find((g) => g.id === h.goalId)?.title ?? null : null, archived: !!h.archivedAt, paused: !!h.pausedAt,
    phases: table('phase').filter((p) => p.habitId === h.id).sort((a, b) => a.phaseNumber - b.phaseNumber).map((p) => ({
      n: p.phaseNumber, status: p.status, targetText: p.targetText, definitionOfDone: p.definitionOfDone, targetCount: p.targetCount, dailyLimit: p.dailyLimit,
    })),
  }))
  const goals = table('goal').filter((g) => g.sourceNote === 'compass').sort((a, b) => (a.title < b.title ? -1 : a.title > b.title ? 1 : 0)).map((g) => ({
    title: g.title, domain: g.domain, whyText: g.whyText, timeframe: g.timeframe, sourceId: g.sourceId, status: g.status,
  }))
  const pausedLinked = table('habit').filter((h) => h.goalId && h.pausedAt && !h.archivedAt).map((h) => h.title).sort()
  const user = table('user')[0]
  const assessment = user.assessment ? JSON.parse(user.assessment) : null
  return { habits, goals, pausedLinked, assessment, snapshots: table('compassSnapshot').length }
}

const draftA = {
  assessment: { contentmentPersonal: 3, contentmentPersonalWhy: 'tired', contentmentProfessional: 4, priorities: ['kids', '', 'health'],
    highQualityHours: '6-8am', workingWell: ['walks'], notWorking: [''], obstacles: ['late meetings'],
    pastStickyHabits: [{ habit: 'flossing', whyItStuck: 'tied to brushing' }, { habit: '  ', whyItStuck: 'x' }] },
  vision: { dreamBig: 'calm and strong', domainVisions: [{ domain: 'health', vision: 'run a half' }], idealIdentity: 'I am someone who shows up' },
  goals: [
    { id: 'goal-a', title: 'Run a half marathon', domain: 'health', whyText: ' for the kids ', timeframe: 'by June' },
    { id: 'goal-b', title: 'Learn te reo Māori', domain: 'mind', whyText: '', timeframe: '' },
    { id: 'goal-c', title: '   ', domain: 'money' },
  ],
}
const draftB = { ...draftA, goals: [{ ...draftA.goals[0], title: 'Run a half marathon in under 2h' }, { id: 'goal-d', title: 'Save a house deposit', domain: 'money' }] }

const readsForm = { title: 'I am someone who reads', cueType: 'location', cueLocation: 'the couch', failSafeAction: 'open the book', targetText: 'Read 5 pages',
  checkStyle: 'yesno', checkQuestion: ' Did I read? ', reminderEnabled: false, goalTitle: 'Learn te reo Māori' }

const designOps: any[] = [
  // Make room under the six-habit cap.
  { op: 'archiveHabit', title: 'synth-ladder' },
  { op: 'archiveHabit', title: 'synth-taper' },
  { op: 'archiveHabit', title: 'synth-weekly' },
  { op: 'compassSave', draft: draftA },
  { op: 'createHabit', form: { title: 'I am someone who runs', goalTitle: 'Run a half marathon', anchorRoutine: 'drop the kids at school', failSafeAction: 'put on my running shoes',
      targetText: 'Run 10 mins', definitionOfDone: 'back at the gate', targetCount: 5, celebration: ' fist pump ', reminderTime: '07:30',
      days: [1, 3, 5], setbacks: [{ obstacle: ' it rains ', plan: 'treadmill ' }, { obstacle: '', plan: 'x' }], sectionNotes: { cue: ' shoes by door ', craving: '  ' },
      extraPhases: [{ targetText: 'Run 20 mins', definitionOfDone: '', targetCount: 10, dailyLimit: 0 }, { targetText: 'Run 30 mins', definitionOfDone: 'lap done', targetCount: 14, dailyLimit: 0 }] } },
  { op: 'createHabit', form: { kind: 'break', breakMode: 'taper', title: 'I am someone free of late coffee', avoidTrigger: 'the 3pm slump', cueType: 'time', cueTime: '15:00',
      replacementAction: 'a glass of water', failSafeAction: 'three breaths', targetText: '≤1 a day', targetCount: 7, dailyLimit: 1, checkStyle: 'yesno',
      scheduleType: 'weekly', timesPerWeek: 4, reminderEnabled: true, extraPhases: [{ targetText: 'none', definitionOfDone: '', targetCount: 14, dailyLimit: 0 }] } },
  // A seventh live habit: refused at the cap.
  { op: 'createHabit', form: readsForm },
  { op: 'editHabit', title: 'I am someone who runs', patch: { targetText: 'Run 12 mins', scheduleType: 'weekly', timesPerWeek: 3, celebration: '', whyText: 'energy' },
      removeExtra: [0], appendExtra: [{ targetText: 'Run 45 mins', definitionOfDone: '', targetCount: 21, dailyLimit: 0 }] },
  { op: 'editHabit', title: 'I am someone free of late coffee', patch: { scheduleType: 'days', days: [0, 6], avoidTrigger: 'the afternoon slump', dailyLimit: 0 } },
  { op: 'compassSnapshot', label: ' Spring ' },
  { op: 'compassSave', draft: draftB },
  { op: 'compassRestoreLatest' },
  { op: 'archiveHabit', title: 'I am someone free of late coffee' },
  { op: 'createHabit', form: readsForm },
  { op: 'compassReset' },
]

globalThis.setHarnessNow(NOW)
const scenario = []
for (const o of ops) {
  const result = await runOp(o)
  scenario.push({ ...o, result, habitAfter: o.habit ? habitSnapshot(o.habit) : null, checkinsAfter: o.habit ? null : checkinSnapshot() })
}
// --- 3c. The AI prompts the web sends, captured from the routes ------------
//
// Taken after the daily-loop scenario and before the design scenario, so the
// packs carry real reasons, check-ins and a graduated ladder.

const promptGoal = table('goal').find((g) => g.status === 'active')!
async function capture(path: string, body: any) {
  geminiCalls.length = 0
  await callRoute(aiRouter, 'post', path, req({ body }))
  return geminiCalls[geminiCalls.length - 1]
}
const opener = [{ role: 'model', text: 'Hello.' }, { role: 'user', text: 'Ready.' }]
const prompts = {
  goalTitle: promptGoal.title,
  checkin: (await capture('/checkin', { messages: opener, wsId })).system,
  insights: (await capture('/insights', { wsId })).prompt,
  compassReality: (await capture('/compass', { stage: 'reality', messages: opener })).system,
  compassFirstStep: (await capture('/compass', { stage: 'first-step', messages: opener })).system,
  interviewBuild: (await capture('/blueprint-interview', { messages: opener, kind: 'build' })).system,
  interviewBreak: (await capture('/blueprint-interview', { messages: opener, kind: 'break', wsId, goalId: promptGoal.id })).system,
  draftBreak: await capture('/blueprint-draft', { messages: [...opener, { role: 'model', text: 'Why?' }, { role: 'user', text: 'Sleep.' }], kind: 'break' }),
  coach: (await capture('/coach', { messages: [{ role: 'user', text: 'How do I make it stick?' }], wsId })).system,
  summary: await capture('/checkin-summary', { messages: [...opener, { role: 'model', text: 'How was it?' }, { role: 'user', text: 'Good.' }] }),
}

const design = []
for (const o of designOps) {
  const result = await designOp(o)
  design.push({ ...o, result, after: designSnapshot() })
}

// Concreteness: the Architect's sharpening hints, over a spread of drafts.
const concreteInputs = [
  {}, { title: 'I am someone who runs', anchorRoutine: 'brush teeth', failSafeAction: 'shoes on', targetText: 'Run 15 mins', definitionOfDone: 'x', celebration: 'yay', temptationBundle: 'podcast' },
  { title: 'run more', anchorRoutine: 'wake', failSafeAction: 'go for a long run and then stretch', targetText: 'run a lot' },
  { title: "I'm a reader", cueType: 'time', cueTime: '7:00', failSafeAction: 'open the book', targetText: '10 pages', definitionOfDone: 'done' },
  { title: 'Im the kind of person', cueType: 'location', cueLocation: 'x', targetText: '3x a week' },
  { kind: 'break', title: 'I am someone who is free of scrolling', avoidTrigger: 'phone in bed', cueType: 'time', cueTime: '22:00', replacementAction: 'read', failSafeAction: 'phone face-down, 3 breaths', frictionDevice: 'charger in kitchen', temptationBundle: 'sleep', celebration: 'tell partner', targetText: 'Stay scroll-free 14 days' },
  { kind: 'break', title: 'quit sugar', failSafeAction: 'a'.repeat(81), targetText: '2 glasses of water' },
  { title: 'I am  someone', failSafeAction: 'one two three four five six seven eight nine ten eleven twelve thirteen', targetText: 'Walk 2km', definitionOfDone: ' ' },
].flatMap((f) => [true, false].map((needsTarget) => {
  const i = { ...emptyForm, ...f, needsTarget }
  const r = scoreConcreteness(i as any)
  return { input: f, needsTarget, score: r.score, checks: r.checks.map((c) => ({ key: c.key, passed: c.passed })) }
}))

const afterViews = [await snapshotViews(NOW), await snapshotViews('2026-10-30T03:00:00.000Z')]
const afterMomentum = [await momentumAt(NOW)]

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
  momentumViews,
  afterMomentum,
  design,
  concreteness: concreteInputs,
  prompts,
  stats: { cases: statsCases, bh, circ },
  body,
}

writeFileSync('ios/OnePercentTests/Fixtures/golden.json', JSON.stringify(golden))
writeFileSync('ios/OnePercentTests/Fixtures/export.json', JSON.stringify(ex))
console.log(`habits: ${real.length}, random: ${random.length}, views: ${views.length}, scenario ops: ${scenario.length}`)
console.log(`progressDays ${series.progressDays.toFixed(3)} → ${formatMultiplier(series.actual.at(-1)?.value ?? 1)}`)
