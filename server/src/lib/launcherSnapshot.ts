// Pushes a compact dashboard snapshot to the Arsh OS launcher (project
// launcher-d672b) so its Pulse page + tiles can show live One Percent data.
// Fully additive: if LAUNCHER_SA_KEY is unset it no-ops, and nothing here is
// read by the app itself. Reuses the app's timezone helpers; the rhythm /
// anchoring math mirrors routes/momentum.ts (keep the two in sync).
import { cert, getApps, initializeApp } from 'firebase-admin/app'
import { getFirestore } from 'firebase-admin/firestore'
import { prisma } from './prisma.js'
import { localDate, localWeekStartMonday } from './time.js'
import { parseSchedule, resolveRange, boundsOf } from './schedule.js'

const OWNER_EMAIL = process.env.LAUNCHER_OWNER_EMAIL || 'arshdeep.m@gmail.com'
const DAY_MS = 86_400_000
const WINDOW = 30
const GRID_DAYS = 365

// Secondary admin app pointed at the launcher's Firestore.
function launcherDb() {
  const keyJson = process.env.LAUNCHER_SA_KEY
  if (!keyJson) return null
  const existing = getApps().find((a) => a.name === 'launcher')
  const app = existing ?? initializeApp({ credential: cert(JSON.parse(keyJson)) }, 'launcher')
  return getFirestore(app)
}

// --- mirrors routes/momentum.ts ---------------------------------------------
const RHYTHM_HALFLIFE = 14
const RHYTHM_LOOKBACK = 60
// `scheduledOn` is the materialized schedule from lib/schedule.ts — it already
// drops pre-creation days, paused stretches, and (for a weekly quota) days the
// habit had slack on.
function rhythmScore(scheduledOn: Map<string, boolean>, hitDates: Set<string>, tz: string, now: number): number {
  let wsum = 0, hit = 0
  for (let i = 0; i < RHYTHM_LOOKBACK; i++) {
    const ds = localDate(new Date(now - i * DAY_MS), tz)
    if (!scheduledOn.get(ds)) continue
    const w = Math.pow(0.5, i / RHYTHM_HALFLIFE)
    wsum += w
    if (hitDates.has(ds)) hit += w
  }
  return wsum > 0 ? Math.round((hit / wsum) * 100) : 0
}
function localHourFraction(d: Date, timezone: string): number {
  try {
    const parts = new Intl.DateTimeFormat('en-GB', { timeZone: timezone, hour: '2-digit', minute: '2-digit', hour12: false }).formatToParts(d)
    const h = Number(parts.find((p) => p.type === 'hour')?.value ?? 0) % 24
    const m = Number(parts.find((p) => p.type === 'minute')?.value ?? 0)
    return (h + m / 60) / 24
  } catch {
    return (d.getHours() + d.getMinutes() / 60) / 24
  }
}
function anchoringScore(fractions: number[]): number | null {
  if (fractions.length < 3) return null
  let sx = 0, sy = 0
  for (const f of fractions) { const a = f * 2 * Math.PI; sx += Math.cos(a); sy += Math.sin(a) }
  return Math.round((Math.sqrt(sx * sx + sy * sy) / fractions.length) * 100)
}
// --------------------------------------------------------------------------

export async function pushHabitSnapshot(now = new Date()): Promise<string> {
  const db = launcherDb()
  if (!db) return 'skipped: LAUNCHER_SA_KEY unset'

  const user = await prisma.user.findUnique({ where: { email: OWNER_EMAIL } })
  if (!user) return `skipped: no user ${OWNER_EMAIL}`
  const ws = await prisma.workstation.findFirst({ where: { userId: user.id, deletedAt: null } })
  if (!ws) return 'skipped: no workstation'
  const tz = user.timezone || 'Pacific/Auckland'
  const wsId = ws.id

  const habits = await prisma.habit.findMany({
    where: { workstationId: wsId, archivedAt: null },
    include: { phases: true },
  })
  const habitIds = habits.map((h) => h.id)
  const logs = habitIds.length
    ? await prisma.habitLog.findMany({ where: { habitId: { in: habitIds } }, select: { date: true, status: true, habitId: true, createdAt: true } })
    : []

  const success = logs.filter((l) => l.status === 'target' || l.status === 'failsafe')
  const totalVotes = success.length

  const nowMs = now.getTime()
  const todayStr = localDate(now, tz)

  const windowDates: string[] = []
  for (let i = 0; i < WINDOW; i++) windowDates.push(localDate(new Date(nowMs - i * DAY_MS), tz))
  const windowSet = new Set(windowDates)

  // Contributions heatmap (365d)
  const counts = new Map<string, number>()
  for (const l of success) counts.set(l.date, (counts.get(l.date) ?? 0) + 1)
  const heatmap: { date: string; count: number }[] = []
  for (let i = GRID_DAYS - 1; i >= 0; i--) {
    const ds = localDate(new Date(nowMs - i * DAY_MS), tz)
    heatmap.push({ date: ds, count: counts.get(ds) ?? 0 })
  }

  // One pass per habit off a single materialized schedule — adherence,
  // consistency, recoveries, today's load and danger days all read the same
  // resolution, so the launcher tile can't disagree with the app.
  const consistencies: number[] = []
  const anchorings: number[] = []
  let recoveries = 0
  let expected = 0
  let totalToday = 0
  let doneToday = 0
  let dangerDays = 0
  const doneTodaySet = new Set(success.filter((l) => l.date === todayStr).map((l) => l.habitId))

  for (const h of habits) {
    const created = localDate(new Date(h.createdAt), tz)
    const hs = success.filter((l) => l.habitId === h.id)
    const hitDates = new Set(hs.map((l) => l.date))
    const resolved = resolveRange(parseSchedule(h), created, todayStr, hitDates, boundsOf(h, tz))
    const scheduledOn = new Map(resolved.map((d) => [d.date, d.scheduled]))

    for (const ds of windowDates) if (scheduledOn.get(ds)) expected++

    const rhythm = rhythmScore(scheduledOn, hitDates, tz, nowMs)
    const anchoring = anchoringScore(hs.map((l) => localHourFraction(new Date(l.createdAt), tz)))
    if (!h.pausedAt) {
      consistencies.push(anchoring === null ? rhythm : Math.round(0.6 * rhythm + 0.4 * anchoring))
      if (anchoring !== null) anchorings.push(anchoring)
    }

    // Recoveries — a missed scheduled day immediately followed (next scheduled) by a hit.
    const scheduled = resolved.filter((d) => d.scheduled).map((d) => d.date)
    for (let i = 0; i < scheduled.length - 1; i++) {
      if (!hitDates.has(scheduled[i]) && hitDates.has(scheduled[i + 1])) recoveries++
    }

    if (h.pausedAt) continue
    if (scheduledOn.get(todayStr)) {
      totalToday++
      if (doneTodaySet.has(h.id)) doneToday++
    }
    // Danger day — the previous day this habit actually asked for was missed
    // (never-miss-twice at risk).
    for (let i = scheduled.length - 1; i >= 0; i--) {
      if (scheduled[i] >= todayStr) continue
      if (!hitDates.has(scheduled[i])) dangerDays++
      break
    }
  }
  const avg = (a: number[]) => (a.length ? Math.round(a.reduce((x, y) => x + y, 0) / a.length) : 0)
  const consistency = avg(consistencies)
  const anchoring = avg(anchorings)
  const windowSuccesses = success.filter((l) => windowSet.has(l.date)).length
  const adherence = expected > 0 ? Math.round((Math.min(windowSuccesses, expected) / expected) * 100) : 0
  const remainingToday = totalToday - doneToday

  const graduated = await prisma.phase.count({ where: { status: 'graduated', habit: { workstationId: wsId } } })
  const checkin = await prisma.checkIn.findFirst({ where: { workstationId: wsId, weekOf: localWeekStartMonday(now, tz) } })
  const checkinDue = !checkin

  // --- assemble payload ---
  const today: { label: string; urgent?: boolean }[] = []
  if (remainingToday > 0) today.push({ label: `${remainingToday} habit${remainingToday === 1 ? '' : 's'} left` })
  if (dangerDays > 0) today.push({ label: `${dangerDays} danger day${dangerDays === 1 ? '' : 's'}`, urgent: true })
  if (checkinDue) today.push({ label: 'Check-in due', urgent: true })

  const alerts: { label: string; urgent?: boolean }[] = []
  if (checkinDue) alerts.push({ label: 'Weekly check-in due', urgent: true })
  if (dangerDays > 0) alerts.push({ label: `${dangerDays} habit${dangerDays === 1 ? '' : 's'} at risk today`, urgent: true })

  await db.collection('summaries').doc('habits').set({
    tileStat: `${doneToday}/${totalToday} today · ${adherence}% adherence`,
    today,
    dashboard: {
      title: 'One Percent',
      alerts,
      rings: [
        { label: '30-day adherence', value: adherence, max: 100, unit: '%' },
        { label: 'Consistency', value: consistency, max: 100, unit: '%' },
        { label: 'Anchoring', value: anchoring, max: 100, unit: '%' },
      ],
      stats: [
        { label: 'Identity votes', value: String(totalVotes) },
        { label: 'Recoveries', value: String(recoveries), tone: 'good' },
        { label: 'Habits today', value: `${doneToday}/${totalToday}` },
        { label: 'Phases graduated', value: String(graduated) },
      ],
      heatmap,
    },
    updatedAt: Date.now(),
  })

  return `ok: ${doneToday}/${totalToday} today, ${totalVotes} votes`
}
