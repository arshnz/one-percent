import { onRequest } from 'firebase-functions/v2/https'
import { onSchedule } from 'firebase-functions/v2/scheduler'
import app from './app.js'
import { prisma } from './lib/prisma.js'
import { runReminders } from './lib/reminders.js'
import { runDailyDigest } from './lib/digest.js'
import { runCheckinNudge } from './lib/checkinNudge.js'
import { runIaRaNudge } from './lib/iaraNudge.js'
import { pushHabitSnapshot } from './lib/launcherSnapshot.js'

export const api = onRequest(
  {
    region: 'us-central1',
    memory: '512MiB',
    timeoutSeconds: 60,
    minInstances: 0,
    invoker: 'public',
    secrets: [
      'DATABASE_URL', 'DIRECT_URL', 'JWT_SECRET', 'GEMINI_API_KEY',
      // The notifications route (vapid-public-key, subscribe, test-run) runs in
      // this Express app, so it needs the push + email secrets too.
      'GMAIL_USER', 'GMAIL_APP_PASSWORD',
      'VAPID_PUBLIC_KEY', 'VAPID_PRIVATE_KEY', 'VAPID_SUBJECT',
      // The Garmin collector POSTs to /api/wearable/ingest with this shared
      // secret. Create it in Secret Manager BEFORE deploying — naming a secret
      // that doesn't exist yet fails the whole functions deploy (see the note
      // on LAUNCHER_SA_KEY below).
      'WEARABLE_INGEST_SECRET',
      // Where the Garmin collector's manual trigger lives, so Settings can
      // offer 'sync now'. Optional: the route 503s cleanly when unset.
      'GARMIN_SYNC_URL',
    ],
  },
  app
)

// The nudge engine. Wakes every 15 minutes and sends reminders for any habit
// whose local cue time just passed (per-user timezone). Idempotent per day.
export const sendReminders = onSchedule(
  {
    schedule: 'every 15 minutes',
    region: 'us-central1',
    memory: '512MiB',
    timeoutSeconds: 120,
    secrets: [
      'DATABASE_URL', 'DIRECT_URL',
      'GMAIL_USER', 'GMAIL_APP_PASSWORD',
      'VAPID_PUBLIC_KEY', 'VAPID_PRIVATE_KEY', 'VAPID_SUBJECT',
      // Arsh OS launcher push: add 'LAUNCHER_SA_KEY' here once the secret is
      // created in Secret Manager — declaring it before it exists fails the
      // whole functions deploy. pushHabitSnapshot no-ops while it's unset.
    ],
  },
  async () => {
    const now = new Date()

    // ── Every reminder email is off. The phones send them now. ──────────────
    //
    // Turned off 30 October 2026, once both iOS apps were installed and each
    // of the four daily mails had an on-device replacement:
    //
    //   runReminders     → One Percent, Reminders.swift (per-habit nudges)
    //   runCheckinNudge  → One Percent, Reminders.swift (Sunday check-in)
    //   runDailyDigest   → One Percent, Reminders.swift (the morning digest,
    //                      added the same day — it was the last one missing)
    //   runIaRaNudge     → Āta kai's own local notification, a separate app
    //
    // A local notification beats a mail for this job on every count: it is
    // timed on the device rather than by a cron that has to guess a timezone,
    // it can be switched off and retimed per notification in Settings, and it
    // does not need a Gmail transport, a Postgres row or a function that wakes
    // every fifteen minutes to decide whether to say nothing.
    //
    // Left as a flag rather than deleted. The code and its tests still work,
    // the ios/README's plan is to retire this server entirely, and until that
    // happens this is a one-word change if a phone ever has to hand the job
    // back. Flip to true to resume.
    const EMAIL_REMINDERS = false

    const reminders = EMAIL_REMINDERS ? await runReminders(prisma, now) : 'off'
    const digest = EMAIL_REMINDERS ? await runDailyDigest(prisma, now) : 'off'
    const checkinNudge = EMAIL_REMINDERS ? await runCheckinNudge(prisma, now) : 'off'
    // A guest on this scheduler — see iaraNudge.ts. Never let it affect the
    // habit reminders that this function actually exists for.
    let iara: unknown = 'off'
    if (EMAIL_REMINDERS) {
      try { iara = await runIaRaNudge(prisma, now) } catch (e) { iara = `error: ${(e as Error).message}` }
    }
    // Never let a launcher-push failure affect reminders.
    let launcher = 'skipped'
    try { launcher = await pushHabitSnapshot(now) } catch (e) { launcher = `error: ${(e as Error).message}` }
    console.log('[sendReminders]', JSON.stringify({ reminders, digest, checkinNudge, launcher, iara }))
  }
)
