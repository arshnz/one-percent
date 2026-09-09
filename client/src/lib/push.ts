import { notifications as notificationsApi } from './api'

// VAPID public keys are base64url; the PushManager wants a Uint8Array.
function urlBase64ToUint8Array(base64: string): Uint8Array {
  const padding = '='.repeat((4 - (base64.length % 4)) % 4)
  const b64 = (base64 + padding).replace(/-/g, '+').replace(/_/g, '/')
  const raw = atob(b64)
  const out = new Uint8Array(raw.length)
  for (let i = 0; i < raw.length; i++) out[i] = raw.charCodeAt(i)
  return out
}

export function pushSupported(): boolean {
  return 'serviceWorker' in navigator && 'PushManager' in window && 'Notification' in window
}

async function getRegistration(): Promise<ServiceWorkerRegistration> {
  const existing = await navigator.serviceWorker.getRegistration()
  if (existing) return existing
  return navigator.serviceWorker.register('/sw.js')
}

// Full opt-in flow for THIS device: permission → SW → subscribe → persist.
// Throws with a user-friendly message on each failure point.
export async function enablePushOnThisDevice(): Promise<void> {
  if (!pushSupported()) throw new Error('This browser doesn’t support push notifications.')

  const permission = await Notification.requestPermission()
  if (permission !== 'granted') throw new Error('Notification permission was not granted.')

  const reg = await getRegistration()
  await navigator.serviceWorker.ready

  const { key } = await notificationsApi.vapidPublicKey()

  let sub = await reg.pushManager.getSubscription()
  if (!sub) {
    sub = await reg.pushManager.subscribe({
      userVisibleOnly: true,
      applicationServerKey: urlBase64ToUint8Array(key) as BufferSource,
    })
  }

  const json = sub.toJSON() as { endpoint?: string; keys?: { p256dh?: string; auth?: string } }
  if (!json.endpoint || !json.keys?.p256dh || !json.keys?.auth) {
    throw new Error('Could not read the push subscription.')
  }
  await notificationsApi.subscribe({
    endpoint: json.endpoint,
    keys: { p256dh: json.keys.p256dh, auth: json.keys.auth },
  })
}

// Best-effort teardown on this device.
export async function disablePushOnThisDevice(): Promise<void> {
  if (!pushSupported()) return
  const reg = await navigator.serviceWorker.getRegistration()
  const sub = await reg?.pushManager.getSubscription()
  if (sub) {
    await notificationsApi.unsubscribe(sub.endpoint).catch(() => {})
    await sub.unsubscribe().catch(() => {})
  }
}
