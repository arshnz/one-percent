import { auth as firebaseAuth } from './firebase'

export async function streamAI(
  path: string,
  body: Record<string, unknown>,
  onChunk: (text: string) => void,
): Promise<void> {
  const token = firebaseAuth.currentUser
    ? await firebaseAuth.currentUser.getIdToken()
    : null

  const res = await fetch(`/api${path}`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
    },
    body: JSON.stringify(body),
  })

  if (!res.ok || !res.body) {
    const err = await res.json().catch(() => ({ message: 'AI request failed' }))
    throw new Error(err.message || 'AI request failed')
  }

  const reader = res.body.getReader()
  const decoder = new TextDecoder()
  let buffer = ''

  while (true) {
    const { done, value } = await reader.read()
    if (done) break
    buffer += decoder.decode(value, { stream: true })
    const lines = buffer.split('\n')
    buffer = lines.pop() ?? ''
    for (const line of lines) {
      if (!line.startsWith('data: ')) continue
      const data = line.slice(6).trim()
      if (data === '[DONE]') return
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
  }
}
