import dotenv from 'dotenv'
dotenv.config({ path: '.env.local' }) // DATABASE_URL + GEMINI_API_KEY for local runs
dotenv.config()

import { prisma } from '../lib/prisma.js'
import { embed, toVectorLiteral, EMBED_DIMS } from '../lib/embeddings.js'
import { ATOMIC_HABITS_TEXT } from '../data/atomicHabits.js'

// Pack the book's paragraphs into ~1800-char chunks with a small overlap so a
// concept that straddles a boundary still survives in at least one chunk.
function chunkText(text: string, size = 1800, overlap = 250): string[] {
  const paras = text
    .split(/\n{2,}/)
    .map((p) => p.replace(/\s+/g, ' ').trim())
    .filter((p) => p.length > 0)

  const chunks: string[] = []
  let cur = ''
  for (const p of paras) {
    if (cur && (cur.length + 1 + p.length) > size) {
      chunks.push(cur.trim())
      const tail = cur.slice(-overlap)
      cur = `${tail} ${p}`
    } else {
      cur = cur ? `${cur} ${p}` : p
    }
  }
  if (cur.trim()) chunks.push(cur.trim())
  return chunks
}

async function ensureTable() {
  // pgvector is available on Supabase; the extension may already be enabled
  // (often in the `extensions` schema), so creating it is best-effort.
  try {
    await prisma.$executeRawUnsafe(`CREATE EXTENSION IF NOT EXISTS vector`)
  } catch (e) {
    console.warn('[ingest] CREATE EXTENSION skipped:', e instanceof Error ? e.message : e)
  }
  // Recreated from scratch each run — the book is static and this is the only
  // writer, so a clean rebuild keeps the dimension/shape in sync with the model.
  // No ANN index: at a few hundred rows, exact nearest-neighbour search is both
  // instant and more accurate (and 3072-d exceeds pgvector's 2000-d index cap).
  await prisma.$executeRawUnsafe(`DROP TABLE IF EXISTS habit."BookChunk"`)
  await prisma.$executeRawUnsafe(
    `CREATE TABLE habit."BookChunk" (
       id        SERIAL PRIMARY KEY,
       idx       INTEGER NOT NULL,
       content   TEXT NOT NULL,
       embedding vector(${EMBED_DIMS}) NOT NULL
     )`
  )
}

async function main() {
  console.log('[ingest] preparing table…')
  await ensureTable()

  const chunks = chunkText(ATOMIC_HABITS_TEXT)
  console.log(`[ingest] ${chunks.length} chunks to embed`)

  for (let i = 0; i < chunks.length; i++) {
    const vec = await embed(chunks[i])
    await prisma.$executeRawUnsafe(
      `INSERT INTO habit."BookChunk" (idx, content, embedding) VALUES ($1, $2, $3::vector)`,
      i,
      chunks[i],
      toVectorLiteral(vec)
    )
    if ((i + 1) % 20 === 0 || i === chunks.length - 1) {
      console.log(`[ingest] embedded ${i + 1}/${chunks.length}`)
    }
  }

  const [{ count }] = await prisma.$queryRawUnsafe<Array<{ count: bigint }>>(
    `SELECT COUNT(*)::bigint AS count FROM habit."BookChunk"`
  )
  console.log(`[ingest] done — ${count} chunks stored.`)
}

main()
  .catch((e) => {
    console.error('[ingest] failed:', e)
    process.exit(1)
  })
  .finally(() => prisma.$disconnect())
