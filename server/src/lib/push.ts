import webpush from 'web-push'

let configured = false

// VAPID keys come from secrets at call time. Returns false if unconfigured.
function ensureConfigured(): boolean {
  if (configured) return true
  const pub = process.env.VAPID_PUBLIC_KEY
  const priv = process.env.VAPID_PRIVATE_KEY
  const subject = process.env.VAPID_SUBJECT || 'mailto:arshdeep.m@gmail.com'
  if (!pub || !priv) return false
  webpush.setVapidDetails(subject, pub, priv)
  configured = true
  return true
}

export interface StoredSubscription {
  endpoint: string
  p256dh: string
  auth: string
}

export interface PushPayload {
  title: string
  body: string
  url?: string
}

// Sends one push. Returns 'gone' when the endpoint is dead (404/410) so the
// caller can prune it; 'ok' on success; 'skip' when VAPID isn't configured.
export async function sendPush(sub: StoredSubscription, payload: PushPayload): Promise<'ok' | 'gone' | 'skip'> {
  if (!ensureConfigured()) { console.warn('[push] VAPID keys not set — skipping'); return 'skip' }
  try {
    await webpush.sendNotification(
      { endpoint: sub.endpoint, keys: { p256dh: sub.p256dh, auth: sub.auth } },
      JSON.stringify(payload)
    )
    return 'ok'
  } catch (err: any) {
    const code = err?.statusCode
    if (code === 404 || code === 410) return 'gone'
    console.error('[push] send failed', code, err?.body ?? err?.message)
    return 'ok' // transient — don't prune on unknown errors
  }
}

export function getVapidPublicKey(): string | null {
  return process.env.VAPID_PUBLIC_KEY ?? null
}
