// Where the API lives.
//
// On the web this is '' — requests go to a relative /api/… path, which Firebase
// Hosting rewrites to the `api` Cloud Function on the same origin. That's the
// shape this app has always had, and leaving VITE_API_BASE unset keeps every
// emitted URL byte-identical to it.
//
// In the iOS app the bundle is served from capacitor://localhost, so there is no
// origin to be relative to. The iOS build sets VITE_API_BASE to the absolute
// hosting URL, which makes every call cross-origin — see the CORS allowlist in
// server/src/app.ts, which must stay in sync with the origins we ship from.
export const API_BASE: string = import.meta.env.VITE_API_BASE ?? ''
