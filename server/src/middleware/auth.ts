import { Request, Response, NextFunction } from 'express'
import { adminAuth } from '../lib/firebase.js'
import { prisma } from '../lib/prisma.js'

export interface AuthRequest extends Request {
  userId?: string
  userTimezone?: string | null
  firebaseUid?: string
  userEmail?: string
}

// Verifies the Firebase ID token only. Used by /auth/sync, which must run
// BEFORE the Prisma user row exists. req.userId is attached when available
// but is NOT guaranteed here.
export async function requireFirebase(req: AuthRequest, res: Response, next: NextFunction): Promise<void> {
  // Always prefer the Authorization header, fallback to __session cookie
  const token = req.headers.authorization?.replace('Bearer ', '') || req.cookies?.['__session']

  if (!token) {
    res.status(401).json({ error: 'Not authenticated' })
    return
  }

  try {
    const decodedToken = await adminAuth.verifyIdToken(token)

    // Attempt to attach Prisma User ID (+ timezone, so data routes don't have to
    // re-query the user just to localise dates).
    if (decodedToken.email) {
      const user = await prisma.user.findUnique({
        where: { email: decodedToken.email },
        select: { id: true, timezone: true },
      })
      if (user) {
        req.userId = user.id
        req.userTimezone = user.timezone
      }
    }

    req.firebaseUid = decodedToken.uid
    req.userEmail = decodedToken.email
    next()
  } catch (error) {
    console.error('Token verification failed:', error)
    // If it was an old cookie causing issues, let's try to clear it
    res.clearCookie('__session')
    res.status(401).json({ error: 'Invalid or expired token' })
  }
}

// Full auth: valid Firebase token AND a registered Prisma user. All data
// routes must use this — past this point req.userId is guaranteed to be set.
// (Never pass a possibly-undefined userId into a Prisma where-clause: Prisma
// silently drops undefined filters, which would disable the ownership check.)
export async function requireAuth(req: AuthRequest, res: Response, next: NextFunction): Promise<void> {
  await requireFirebase(req, res, (err?: unknown) => {
    if (err) { next(err); return }
    if (!req.userId) {
      res.status(403).json({ error: 'Account not registered yet. Please sign in again.' })
      return
    }
    next()
  })
}
