import jwt, { SignOptions } from 'jsonwebtoken'
import bcrypt from 'bcryptjs'

if (process.env.NODE_ENV === 'production' && !process.env.JWT_SECRET) {
  throw new Error('JWT_SECRET must be set in production')
}

const JWT_SECRET = process.env.JWT_SECRET || 'dev-secret-change-in-production'
const JWT_EXPIRES_IN = process.env.JWT_EXPIRES_IN || '30d'

export interface JwtPayload {
  userId: string
  email: string
}

export function signToken(payload: JwtPayload): string {
  return jwt.sign(payload, JWT_SECRET, { expiresIn: JWT_EXPIRES_IN } as SignOptions)
}

export function verifyToken(token: string): JwtPayload {
  return jwt.verify(token, JWT_SECRET) as JwtPayload
}

export async function hashPassword(password: string): Promise<string> {
  return bcrypt.hash(password, 12)
}

export async function comparePassword(password: string, hash: string): Promise<boolean> {
  return bcrypt.compare(password, hash)
}

export const COOKIE_NAME = '__session'
export const COOKIE_OPTIONS = {
  httpOnly: true,
  secure: process.env.NODE_ENV === 'production',
  sameSite: 'lax' as const,
  maxAge: 30 * 24 * 60 * 60 * 1000, // 30 days
}
