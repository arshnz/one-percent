/// <reference types="vite/client" />

interface ImportMetaEnv {
  /** Absolute API origin. Empty on web (same-origin /api); set for the iOS build. */
  readonly VITE_API_BASE?: string

  readonly VITE_FIREBASE_API_KEY?: string
  readonly VITE_FIREBASE_AUTH_DOMAIN?: string
  readonly VITE_FIREBASE_PROJECT_ID?: string
  readonly VITE_FIREBASE_STORAGE_BUCKET?: string
  readonly VITE_FIREBASE_MESSAGING_SENDER_ID?: string
  readonly VITE_FIREBASE_APP_ID?: string
  readonly VITE_FIREBASE_MEASUREMENT_ID?: string
  /** Dev-only: points the client at the local Auth emulator (npm run dev:emu). */
  readonly VITE_FIREBASE_AUTH_EMULATOR?: string
}

interface ImportMeta {
  readonly env: ImportMetaEnv
}
