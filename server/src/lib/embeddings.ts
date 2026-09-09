import { GoogleGenerativeAI } from '@google/generative-ai'

// Gemini's text embedding model, used for both the one-time book ingestion and
// per-query retrieval in the Habit Coach. gemini-embedding-001 outputs 3072-d
// vectors by default.
export const EMBED_MODEL = 'gemini-embedding-001'
export const EMBED_DIMS = 3072

function getGenAI() {
  const key = process.env.GEMINI_API_KEY
  if (!key) throw new Error('GEMINI_API_KEY is not set')
  return new GoogleGenerativeAI(key)
}

// Embed a single piece of text into a 768-d vector.
export async function embed(text: string): Promise<number[]> {
  const model = getGenAI().getGenerativeModel({ model: EMBED_MODEL })
  const res = await model.embedContent(text)
  return res.embedding.values
}

// pgvector accepts a vector as a string literal like "[0.1,0.2,...]".
export function toVectorLiteral(v: number[]): string {
  return `[${v.join(',')}]`
}
