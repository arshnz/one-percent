import dotenv from 'dotenv'
dotenv.config({ path: '.env.local' })
dotenv.config()

import { prisma } from '../lib/prisma.js'
import { computeMissPredictors } from '../lib/habitEffect.js'

// "Does how my body was predict whether I showed up?" — the reverse of the
// habit-effect analysis, and the source of the one wearable claim the Momentum
// insights are allowed to make. Same guardrails, so run it the same way:
// it should stay quiet unless there is really something there.

async function main() {
  const ws = await prisma.workstation.findFirst({
    where: { deletedAt: null },
    include: { user: { select: { timezone: true } } },
  })
  if (!ws) throw new Error('no workstation')

  const rows = await computeMissPredictors(ws.id, ws.userId, ws.user.timezone)
  if (!rows.length) { console.log('no active habits'); return }

  for (const r of rows) {
    console.log(`${r.metric}`)
    console.log(`  kept everything : n=${String(r.hitDays.n).padStart(3)}  median=${r.hitDays.median}`)
    console.log(`  missed something: n=${String(r.missDays.n).padStart(3)}  median=${r.missDays.median}`)
    console.log(`  diff=${r.difference.toFixed(1)}  p=${r.pValue.toFixed(4)}  -> ${r.verdict}`)
    console.log(`  "${r.sentence}"`)
    console.log()
  }
}

main()
  .catch((e) => { console.error('[check]', e instanceof Error ? e.message : e); process.exitCode = 1 })
  .finally(() => prisma.$disconnect())
