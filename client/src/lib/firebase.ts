import { initializeApp } from 'firebase/app'
import { getAuth, setPersistence, browserLocalPersistence, connectAuthEmulator } from 'firebase/auth'

const env = (import.meta as any).env

const firebaseConfig = {
  apiKey: env.VITE_FIREBASE_API_KEY || "placeholder_api_key",
  authDomain: env.VITE_FIREBASE_AUTH_DOMAIN || "placeholder_auth_domain",
  projectId: env.VITE_FIREBASE_PROJECT_ID || "placeholder_project_id",
  storageBucket: env.VITE_FIREBASE_STORAGE_BUCKET || "placeholder_storage_bucket",
  messagingSenderId: env.VITE_FIREBASE_MESSAGING_SENDER_ID || "placeholder_messaging_sender_id",
  appId: env.VITE_FIREBASE_APP_ID || "placeholder_app_id"
}

export const app = initializeApp(firebaseConfig)
export const auth = getAuth(app)

// Local-only: point the SDK at the Firebase Auth emulator so dev/testing works
// without real Google sign-in. Opt-in via `npm run dev:emu` — never in builds.
if (env.DEV && env.VITE_FIREBASE_AUTH_EMULATOR) {
  connectAuthEmulator(auth, env.VITE_FIREBASE_AUTH_EMULATOR, { disableWarnings: true })
}

// Persist the session in IndexedDB/localStorage so returning users stay
// signed in across reloads and tabs (avoids re-doing the slow Google popup).
setPersistence(auth, browserLocalPersistence).catch(() => {
  // Non-fatal — falls back to the SDK default if the browser blocks storage.
})
