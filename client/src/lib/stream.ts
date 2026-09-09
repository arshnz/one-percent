import { auth as firebaseAuth } from './firebase'
import { API_BASE } from './config'

/**
 * Feed one batch of raw SSE text to the caller. Returns true if the stream
 * signalled [DONE], so the caller knows to stop.
 *
 * Split out so the streaming and non-streaming paths below parse identically —
 * the wire format is the same either way, only the arrival timing differs.
 */
function drain(chunk: string, onChunk: (text: string) => void): boolean {
  for (const line of chunk.split('\n')) {
    if (!line.startsWith('data: ')) continue
    const data = line.slice(6).trim()
    if (data === '[DONE]') return true
    let parsed: { text?: string; error?: string }
    try {
      parsed = JSON.parse(data)
    } catch {
      continue // malformed chunk — skip
    }
    // A mid-stream error event (e.g. the model became unavailable). Surface it.
    if (parsed.error) throw new Error(parsed.error)
    if (parsed.text) onChunk(parsed.text)
  }
  return false
}

export async function streamAI(
  path: string,
  body: Record<string, unknown>,
  onChunk: (text: string) => void,
): Promise<void> {
  const token = firebaseAuth.currentUser
    ? await firebaseAuth.currentUser.getIdToken()
    : null

  const res = await fetch(`${API_BASE}/api${path}`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
    },
    body: JSON.stringify(body),
  })

  if (!res.ok) {
    const err = await res.json().catch(() => ({ message: 'AI request failed' }))
    throw new Error(err.message || 'AI request failed')
  }

  // Fallback for runtimes that don't expose an incrementally-readable body.
  // Every real browser does, so this branch is dead on the web — it exists for
  // the iOS webview, where a buffered response would otherwise leave the caller
  // waiting on a reader that never arrives. The reply lands all at once instead
  // of token-by-token: degraded, not broken.
  if (!res.body || typeof res.body.getReader !== 'function') {
    drain(await res.text(), onChunk)
    return
  }

  const reader = res.body.getReader()
  const decoder = new TextDecoder()
  let buffer = ''

  while (true) {
    const { done, value } = await reader.read()
    if (done) break
    buffer += decoder.decode(value, { stream: true })
    const lines = buffer.split('\n')
    // Keep the trailing partial line in the buffer until its newline arrives.
    buffer = lines.pop() ?? ''
    if (drain(lines.join('\n'), onChunk)) return
  }
}
