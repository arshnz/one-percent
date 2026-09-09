import type { PrismaClient } from '../../generated/prisma/index.js'
import { localDate, localWeekday, localTimeMinutes, parseHHMM } from './time.js'
import { parseSchedule, weekProgress, weekDatesOf, boundsOf } from './schedule.js'
import { sendReminderEmail } from './email.js'
import { sendPush } from './push.js'

const WINDOW_MIN = 15 // matches the 'every 15 minutes' cron cadence
// Thursday — late enough that a quiet Mon–Wed means something, early enough to
// still leave four days to make good on a weekly quota.
const MID_WEEK_NUDGE_DAY = 4

export interface RunOptions {
  userId?: string      // restrict to one user (test-run / self-trigger)
  ignoreWindow?: boolean // bypass the time-of-day match (test-run)
}

export interface RunResult {
  considered: number
  sent: number
  emails: number
  pushes: number
  pruned: number
}

// The nudge engine. Finds habits due for a reminder right now (in each user's
// local time) and fans out to their enabled channels. Idempotent per day via
// Habit.lastRemindedOn.
export async function runReminders(prisma: PrismaClient, now: Date, opts: RunOptions = {}): Promise<RunResult> {
  const res: RunResult = { considered: 0, sent: 0, emails: 0, pushes: 0, pruned: 0 }

  const habits = await prisma.habit.findMany({
    where: {
      archivedAt: null,
      pausedAt: null,
      reminderEnabled: true,
      reminderTime: { not: null },
      ...(opts.userId ? { workstation: { userId: opts.userId } } : {}),
    },
    include: {
      workstation: { include: { user: { include: { pushSubscriptions: true } } } },
      phases: { where: { status: 'active' }, take: 1 },
    },
  })

  for (const habit of habits) {
    res.considered++
    const user = habit.workstation.user
    const tz = user.timezone

    const today = localDate(now, tz)
    if (habit.lastRemindedOn === today) continue

    // Is today a day this habit asks for?
    //
    // Fixed days: weekday membership, as ever. Weekly quota: stay quiet while
    // there's slack — a 3×-a-week habit that nags every morning is just a daily
    // habit with extra steps. Speak up when the buffer is gone (reps left ==
    // days left), plus one mid-week nudge if the week hasn't started at all.
    const sched = parseSchedule(habit)
    if (sched.type === 'days') {
      if (!sched.days.includes(localWeekday(now, tz))) continue
    } else {
      const week = weekDatesOf(today)
      const weekHits = await prisma.habitLog.findMany({
        where: {
          habitId: habit.id,
          date: { gte: week[0], lte: week[6] },
          status: { in: ['target', 'failsafe'] },
        },
        select: { date: true },
      })
      const progress = weekProgress(sched, today, new Set(weekHits.map((l) => l.date)), boundsOf(habit, tz))
      if (!progress || progress.remaining === 0) continue
      const midWeekNudge = progress.hits === 0 && localWeekday(now, tz) === MID_WEEK_NUDGE_DAY
      if (!progress.obligatedToday && !midWeekNudge) continue
    }

    const reminderMin = parseHHMM(habit.reminderTime)
    if (reminderMin === null) continue

    if (!opts.ignoreWindow) {
      const delta = localTimeMinutes(now, tz) - reminderMin
      if (delta < 0 || delta >= WINDOW_MIN) continue
    }

    // Don't nag if today's vote is already cast.
    const log = await prisma.habitLog.findUnique({
      where: { habitId_date: { habitId: habit.id, date: today } },
    })
    if (log && log.status !== 'miss') continue

    const breaking = habit.kind === 'break'
    const target = habit.phases[0]?.targetText ?? habit.title
    const emailOn = user.emailReminders && !!user.email
    const subs = habit.workstation.user.pushSubscriptions
    const pushOn = user.pushReminders && subs.length > 0
    if (!emailOn && !pushOn) continue

    const bundle = habit.temptationBundle?.trim()
    const replacement = habit.replacementAction?.trim()
    const trigger = habit.avoidTrigger?.trim()

    // Break habits get a pre-emptive guard at the moment of risk; build habits
    // get the usual "cast your vote" nudge.
    const pushTitle = breaking
      ? (trigger ? `Heads up: ${trigger} usually hits about now` : 'Stay strong — your risky moment is here')
      : `Time to ${target}`
    const pushBody = breaking
      ? (replacement ? `Your move instead: ${replacement}.` : 'Ride out the urge — a clean day is the vote.')
      : (bundle ? `Make it a treat — ${bundle}.` : `Cast today's vote — even the 2-minute version counts.`)

    if (emailOn) {
      try {
        await sendReminderEmail(user.email, {
          title: habit.title,
          target: breaking ? (trigger ? `resist ${trigger}` : 'stay free today') : target,
          reminderTime: habit.reminderTime,
          temptationBundle: breaking ? (replacement ? `Instead: ${replacement}` : undefined) : bundle,
        })
        res.emails++
      } catch (err) {
        console.error('[reminders] email failed for', habit.id, err)
      }
    }

    if (pushOn) {
      for (const sub of subs) {
        const result = await sendPush(sub, {
          title: pushTitle,
          body: pushBody,
          url: '/app',
        })
        if (result === 'gone') {
          await prisma.pushSubscription.delete({ where: { endpoint: sub.endpoint } }).catch(() => {})
          res.pruned++
        } else if (result === 'ok') {
          res.pushes++
        }
      }
    }

    await prisma.habit.update({ where: { id: habit.id }, data: { lastRemindedOn: today } })
    res.sent++
  }

  return res
}
