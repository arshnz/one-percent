import dotenv from 'dotenv'
dotenv.config({ path: '.env.local' })
dotenv.config()
import { prisma } from '../lib/prisma.js'
import { computeBodyInsights } from '../lib/bodyInsights.js'

async function main() {
  const ws = await prisma.workstation.findFirst({
    where: { deletedAt: null },
    include: { user: { select: { timezone: true } } },
  })
  if (!ws) throw new Error('no workstation')
  const r = await computeBodyInsights(ws.userId, ws.user.timezone)
  console.log(`${r.days} days analysed · activity types: ${r.activityTypes.join(', ') || 'none'}`)
  console.log(`${r.findings.length} finding(s)\n`)
  for (const f of r.findings) {
    console.log(`[${f.kind}]${f.pValue !== undefined ? ` p=${f.pValue.toFixed(4)}` : ''}`)
    console.log(`  ${f.headline}`)
    console.log(`  ${f.detail}\n`)
  }
}
main().catch(e => console.error('[check]', e instanceof Error ? e.message : e))
  .finally(() => prisma.$disconnect())
