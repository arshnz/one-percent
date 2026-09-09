import type { PrismaClient } from '../../generated/prisma/index.js'
import { localDate, localWeekday, localTimeMinutes } from './time.js'
import { parseSchedule, weekProgress, weekDatesOf, boundsOf } from './schedule.js'
import { sendDigestEmail, type DigestItem } from './email.js'

const DIGEST_HOUR = 6        // 6am local
const WINDOW_MIN = 15        // matches the every-15-minutes cron cadence

export interface DigestOptions {
  userId?: string
  ignoreWindow?: boolean     // test-run: skip the 6am match (still dedups per day)
}

export interface DigestResult {
  considered: number
  sent: number
}

// Builds the implementation-intention sentence the same way the habit card does:
// cue phrase + the fail-safe action. Falls back gracefully when pieces are missing.
function intentionLine(h: {
  kind: string; cueType: string; anchorRoutine: string | null; cueTime: string | null
  cueLocation: string | null; failSafeAction: string; title: string
  avoidTrigger: string | null; replacementAction: string | null
}): string {
  // Break habits: a "stay free / do this instead" guard, framed around the trigger.
  if (h.kind === 'break') {
    const instead = (h.replacementAction || '').trim().replace(/^i will\s+/i, '')
    const trigger = (h.avoidTrigger || '').trim()
    if (trigger && instead) return `When ${trigger}, I’ll ${instead} instead`
    if (instead) return `I’ll ${instead} instead of slipping`
    return 'Stay free today — one clean day is a vote'
  }
  const action = (h.failSafeAction || '').trim().replace(/^i will\s+/i, '')
  let cue = ''
  if (h.cueType === 'habit_stack' && h.anchorRoutine) cue = `After I ${h.anchorRoutine.trim()}`
  else if (h.cueType === 'time' && h.cueTime) cue = `At ${h.cueTime}`
  else if (h.cueType === 'location' && h.cueLocation) cue = `When I get to ${h.cueLocation.trim()}`
  if (!cue) return action ? `I will ${action}` : h.title
  return `${cue}, I will ${action}`
}

// The 6am "today's intentions" digest — one email per user listing every habit
// scheduled for today with its implementation intention. Idempotent per day.
export async function runDailyDigest(prisma: PrismaClient, now: Date, opts: DigestOptions = {}): Promise<DigestResult> {
  const res: DigestResult = { considered: 0, sent: 0 }

  const users = await prisma.user.findMany({
    where: {
      emailReminders: true,
      ...(opts.userId ? { id: opts.userId } : {}),
    },
    include: {
      workstations: {
        where: { deletedAt: null },
        include: { habits: { where: { archivedAt: null, pausedAt: null } } },
      },
    },
  })

  for (const user of users) {
    res.considered++
    const tz = user.timezone
    const today = localDate(now, tz)
    if (user.lastDigestOn === today) continue

    if (!opts.ignoreWindow) {
      const mins = localTimeMinutes(now, tz)
      if (mins < DIGEST_HOUR * 60 || mins >= DIGEST_HOUR * 60 + WINDOW_MIN) continue
    }

    const weekday = localWeekday(now, tz)
    const habits = user.workstations.flatMap((w) => w.habits)

    // Weekly-quota habits need this week's reps to know whether today is theirs.
    const week = weekDatesOf(today)
    const weeklyIds = habits.filter((h) => h.scheduleType === 'weekly').map((h) => h.id)
    const weekHits = weeklyIds.length
      ? await prisma.habitLog.findMany({
          where: {
            habitId: { in: weeklyIds },
            date: { gte: week[0], lte: week[6] },
            status: { in: ['target', 'failsafe'] },
          },
          select: { habitId: true, date: true },
        })
      : []
    const hitsByHabit = new Map<string, Set<string>>()
    for (const l of weekHits) {
      let s = hitsByHabit.get(l.habitId)
      if (!s) { s = new Set(); hitsByHabit.set(l.habitId, s) }
      s.add(l.date)
    }

    const items: DigestItem[] = []
    for (const h of habits) {
      const sched = parseSchedule(h)
      if (sched.type === 'days') {
        if (!sched.days.includes(weekday)) continue
        items.push({ title: h.title, intention: intentionLine(h), reminderTime: h.reminderTime })
        continue
      }
      // A weekly habit joins today's intentions when the quota is at risk;
      // otherwise it gets a softer line so the morning email still shows where
      // the week stands without turning a flexible habit into a daily demand.
      const p = weekProgress(sched, today, hitsByHabit.get(h.id) ?? new Set(), boundsOf(h, tz))
      if (!p || p.remaining === 0) continue
      items.push({
        title: h.title,
        intention: p.obligatedToday
          ? intentionLine(h)
          : `${p.hits} of ${p.quota} this week — ${p.remaining} to go, ${p.daysLeft} ${p.daysLeft === 1 ? 'day' : 'days'} left`,
        reminderTime: h.reminderTime,
      })
    }

    // Nothing scheduled today — still stamp the day so we don't re-check every tick.
    if (items.length === 0) {
      await prisma.user.update({ where: { id: user.id }, data: { lastDigestOn: today } })
      continue
    }

    try {
      await sendDigestEmail(user.email, items)
      res.sent++
    } catch (err) {
      console.error('[digest] email failed for', user.id, err)
    }
    await prisma.user.update({ where: { id: user.id }, data: { lastDigestOn: today } })
  }

  return res
}
