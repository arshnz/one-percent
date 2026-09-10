import dotenv from 'dotenv'
dotenv.config({ path: '.env.local' })
dotenv.config()

import { prisma } from '../lib/prisma.js'
import { computeHabitEffect } from '../lib/habitEffect.js'
import { WEARABLE_METRIC_KEYS, type WearableMetric } from '../lib/wearableMetrics.js'

// Runs the effect analysis from the command line, so its two failure modes can
// be checked directly rather than inferred from the UI:
//
//   1. Does it FIND a real effect?
//        npx tsx src/scripts/seedWearable.ts --plant restingHr:-4
//        npx tsx src/scripts/checkHabitEffect.ts <habitId>
//      restingHr should come back 'associated' and improved.
//
//   2. Does it stay QUIET on noise?
//        npx tsx src/scripts/seedWearable.ts
//        npx tsx src/scripts/checkHabitEffect.ts <habitId>
//      Everything should come back 'no_effect' or 'insufficient'.
//
// A build that passes (1) but fails (2) is worse than no feature at all: it
// invents relationships out of noise and the user has no way to tell.
//
// With no habitId it lists the candidates and their log counts.

async function main() {
  const habitId = process.argv[2]

  if (!habitId) {
    const habits = await prisma.habit.findMany({
      where: { archivedAt: null },
      select: { id: true, title: true, _count: { select: { logs: true } } },
      orderBy: { createdAt: 'desc' },
    })
    console.log('Pass a habit id:\n')
    for (const h of habits) {
      console.log(`  ${h.id}  ${String(h._count.logs).padStart(4)} logs  ${h.title.slice(0, 50)}`)
    }
    return
  }

  const habit = await prisma.habit.findUnique({
    where: { id: habitId },
    include: { workstation: { include: { user: { select: { id: true, timezone: true } } } } },
  })
  if (!habit) throw new Error(`No habit ${habitId}`)

  const tz = habit.workstation.user.timezone || 'Pacific/Auckland'
  console.log(`\n"${habit.title}"\n`)

  const rows: string[] = []
  for (const metric of WEARABLE_METRIC_KEYS as WearableMetric[]) {
    const r = await computeHabitEffect(habitId, habit.workstation.user.id, metric, 1, tz)
    if (!r) continue
    const flag =
      r.verdict === 'associated' ? (r.improved ? '  ✓ better' : '  ✗ worse') :
      r.verdict === 'insufficient' ? '  – thin' : '  · none'
    rows.push(
      `${metric.padEnd(16)} hit ${String(r.hit.n).padStart(3)} @ ${String(r.hit.median).padStart(6)}` +
      `   miss ${String(r.miss.n).padStart(3)} @ ${String(r.miss.median).padStart(6)}` +
      `   diff ${r.difference.toFixed(2).padStart(7)}   p=${r.pValue.toFixed(4)}   ${r.verdict}${flag}`
    )
    rows.push(`${' '.repeat(16)}${r.sentence}\n`)
  }
  console.log(rows.join('\n'))
}

main()
  .catch((e) => {
    console.error('[check]', e instanceof Error ? e.message : e)
    process.exitCode = 1
  })
  .finally(() => prisma.$disconnect())
