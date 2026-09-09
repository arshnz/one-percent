import type { PrismaClient } from '../../generated/prisma/index.js'
import { localDate, localTimeMinutes } from './time.js'
import { iaRaLineFor, sendIaRaEmail } from './email.js'

const NUDGE_HOUR = 19   // 7pm local
const WINDOW_MIN = 15   // matches the every-15-minutes cron cadence

export interface IaRaNudgeOptions {
  ignoreWindow?: boolean  // test-run: skip the 7pm match (still dedups)
}

export interface IaRaNudgeResult {
  sent: number
  skipped: string | null
}

/** Ia Rā's 7pm nudge — https://ia-ra.web.app
 *
 *  A different app entirely. It borrows this server because Ia Rā shares a
 *  Firebase project with a parked planner, and a functions codebase deployed
 *  there can prune that planner's `api`; this server already wakes every
 *  fifteen minutes with a working Gmail transport, so the reminder costs
 *  nothing new and risks nothing over there.
 *
 *  **Only ever the account that sends the mail.** The recipient is GMAIL_USER,
 *  the sending mailbox itself — so no other One Percent user can ever receive a
 *  nudge for an app that is not theirs. Do not widen this to all users. */
export async function runIaRaNudge(
  prisma: PrismaClient,
  now: Date,
  opts: IaRaNudgeOptions = {},
): Promise<IaRaNudgeResult> {
  const to = process.env.GMAIL_USER
  if (!to) return { sent: 0, skipped: 'GMAIL_USER not set' }

  // The dedup stamp lives on the owner's user row. No row, no nudge — rather
  // than sending unguarded and risking four mails an hour on a retry.
  const user = await prisma.user.findUnique({ where: { email: to } })
  if (!user) return { sent: 0, skipped: `no user for ${to}` }

  const tz = user.timezone
  const today = localDate(now, tz)
  if (user.lastIaRaNudgeOn === today) return { sent: 0, skipped: 'already sent today' }

  if (!opts.ignoreWindow) {
    const mins = localTimeMinutes(now, tz)
    if (mins < NUDGE_HOUR * 60 || mins >= NUDGE_HOUR * 60 + WINDOW_MIN) {
      return { sent: 0, skipped: 'outside window' }
    }
  }

  // Stamp first. A duplicate mail is worse than a missed one here — this is a
  // nudge, and tomorrow's will do just as well.
  await prisma.user.update({ where: { id: user.id }, data: { lastIaRaNudgeOn: today } })

  try {
    await sendIaRaEmail(to, iaRaLineFor(today))
    return { sent: 1, skipped: null }
  } catch (err) {
    console.error('[iaraNudge] email failed', err)
    return { sent: 0, skipped: 'send failed' }
  }
}
