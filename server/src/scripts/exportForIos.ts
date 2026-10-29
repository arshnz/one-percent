import dotenv from 'dotenv'
dotenv.config({ path: '.env.local' })
dotenv.config()

import { writeFileSync, mkdirSync } from 'node:fs'
import { prisma } from '../lib/prisma.js'

// One-time export of one user's data for the native iOS app to import.
//
//   npx tsx src/scripts/exportForIos.ts you@example.com
//
// Writes backups/ios-export-<date>.json at the repo root (gitignored). The
// shape is the Prisma rows as-is, nested by ownership, so the Swift importer
// maps fields one-to-one. Left out on purpose: push subscriptions and the
// password hash (meaningless on-device), WearableSync (server bookkeeping),
// and the Wearable*Raw payloads (hundreds of MB of Garmin JSON nothing reads).
// Book chunks go without their Gemini embeddings; the app re-embeds on-device.

async function main() {
  const email = process.argv[2]
  if (!email) throw new Error('usage: exportForIos.ts <email>')

  const user = await prisma.user.findUniqueOrThrow({ where: { email } })
  const { password: _password, ...profile } = user

  const workstations = await prisma.workstation.findMany({
    where: { userId: user.id },
    include: {
      goals: true,
      checkIns: true,
      compassSnapshots: true,
      coachChats: { include: { messages: { orderBy: { createdAt: 'asc' } } } },
      habits: {
        include: {
          phases: { orderBy: { phaseNumber: 'asc' } },
          logs: { orderBy: { date: 'asc' } },
          checks: true,
          metricLinks: true,
        },
      },
    },
  })

  // `omit` is preview-only on Prisma 5.22, so drop `raw` after the fact.
  const wearableDays = (await prisma.wearableDay.findMany({
    where: { userId: user.id },
    orderBy: { date: 'asc' },
  })).map(({ raw: _raw, ...d }) => d)
  const wearableActivities = (await prisma.wearableActivity.findMany({
    where: { userId: user.id },
    orderBy: { startedAt: 'asc' },
  })).map(({ raw: _raw, ...a }) => a)
  const bookChunks: { idx: number; content: string }[] =
    await prisma.$queryRaw`SELECT idx, content FROM habit."BookChunk" ORDER BY idx`

  const out = {
    format: 'one-percent-ios-export',
    version: 1,
    exportedAt: new Date().toISOString(),
    user: profile,
    workstations,
    wearableDays,
    wearableActivities,
    bookChunks,
  }

  mkdirSync('../backups', { recursive: true })
  const path = `../backups/ios-export-${new Date().toISOString().slice(0, 10)}.json`
  writeFileSync(path, JSON.stringify(out, null, 1))

  const habits = workstations.flatMap((w) => w.habits)
  console.log(`wrote ${path}`)
  console.log({
    workstations: workstations.length,
    habits: habits.length,
    logs: habits.reduce((n, h) => n + h.logs.length, 0),
    goals: workstations.reduce((n, w) => n + w.goals.length, 0),
    checkIns: workstations.reduce((n, w) => n + w.checkIns.length, 0),
    coachChats: workstations.reduce((n, w) => n + w.coachChats.length, 0),
    wearableDays: wearableDays.length,
    wearableActivities: wearableActivities.length,
    bookChunks: bookChunks.length,
  })
}

main().finally(() => prisma.$disconnect())
