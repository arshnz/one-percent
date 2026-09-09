import { initializeApp, getApps } from 'firebase-admin/app'
import { getAuth } from 'firebase-admin/auth'

// projectId is enough for verifyIdToken (signature + audience checks) in local
// dev — no service-account credential needed since we don't checkRevoked.
const projectId = process.env.FIREBASE_PROJECT_ID || process.env.GOOGLE_CLOUD_PROJECT

const apps = getApps()
const app = apps.length === 0 ? initializeApp(projectId ? { projectId } : undefined) : apps[0]

export const adminAuth = getAuth(app)
