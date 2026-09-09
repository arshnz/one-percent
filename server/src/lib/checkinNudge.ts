import type { PrismaClient } from '../../generated/prisma/index.js'
import { localDate, localWeekday, localTimeMinutes, localWeekStartMonday } from './time.js'
import { sendCheckinEmail } from './email.js'
import { sendPush } from './push.js'

const NUDGE_HOUR = 17       // 5pm local on Sundays
const WINDOW_MIN = 15       // matches the every-15-minutes cron cadence
const SUNDAY = 0

export interface CheckinNudgeOptions {
  userId?: string
  ignoreWindow?: boolean    // test-run: skip the Sunday-5pm match (still dedups)
}

export interface CheckinNudgeResult {
  considered: number
  sent: number
  emails: number
  pushes: number
  pruned: number
}

// The weekly reflection nudge — Sunday ~5pm local, once per user per day. Only
// nudges users who have a habit worth reflecting on and haven't already checked
// in for the week. Mirrors the digest/reminder engines' timezone + dedup shape.
export async function runCheckinNudge(prisma: PrismaClient, now: Date, opts: CheckinNudgeOptions = {}): Promise<CheckinNudgeResult> {
  const res: CheckinNudgeResult = { considered: 0, sent: 0, emails: 0, pushes: 0, pruned: 0 }

  const users = await prisma.user.findMany({
    where: { ...(opts.userId ? { id: opts.userId } : {}) },
    include: {
      pushSubscriptions: true,
      workstations: {
        where: { deletedAt: null },
        include: {
          habits: { where: { archivedAt: null, pausedAt: null }, select: { id: true } },
          checkIns: true,
        },
      },
    },
  })

  for (const user of users) {
    res.considered++
    const tz = user.timezone
    const today = localDate(now, tz)
    if (user.lastCheckinNudgeOn === today) continue

    if (!opts.ignoreWindow) {
      if (localWeekday(now, tz) !== SUNDAY) continue
      const mins = localTimeMinutes(now, tz)
      if (mins < NUDGE_HOUR * 60 || mins >= NUDGE_HOUR * 60 + WINDOW_MIN) continue
    }

    const ws = user.workstations[0]
    // Nothing to reflect on yet — stamp the day so we don't re-check every tick.
    if (!ws || ws.habits.length === 0) {
      await prisma.user.update({ where: { id: user.id }, data: { lastCheckinNudgeOn: today } })
      continue
    }

    // Already checked in for this week? Skip, but still stamp.
    const weekOf = localWeekStartMonday(now, tz)
    if (ws.checkIns.some((c) => c.weekOf === weekOf)) {
      await prisma.user.update({ where: { id: user.id }, data: { lastCheckinNudgeOn: today } })
      continue
    }

    const emailOn = user.emailReminders && !!user.email
    const pushOn = user.pushReminders && user.pushSubscriptions.length > 0

    if (emailOn) {
      try { await sendCheckinEmail(user.email); res.emails++ }
      catch (err) { console.error('[checkinNudge] email failed for', user.id, err) }
    }
    if (pushOn) {
      for (const sub of user.pushSubscriptions) {
        const result = await sendPush(sub, {
          title: 'Your weekly check-in is ready',
          body: 'Take five minutes to look back on the week — what worked, what didn’t, what’s next.',
          url: '/app/checkin',
        })
        if (result === 'gone') {
          await prisma.pushSubscription.delete({ where: { endpoint: sub.endpoint } }).catch(() => {})
          res.pruned++
        } else if (result === 'ok') res.pushes++
      }
    }

    if (emailOn || pushOn) res.sent++
    await prisma.user.update({ where: { id: user.id }, data: { lastCheckinNudgeOn: today } })
  }

  return res
}
