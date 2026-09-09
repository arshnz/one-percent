import { Request, Response, NextFunction } from 'express'
import { ZodError } from 'zod'

export function errorHandler(err: unknown, _req: Request, res: Response, _next: NextFunction): void {
  if (err instanceof ZodError) {
    res.status(400).json({ error: 'Validation error', details: err.flatten() })
    return
  }

  // Prisma unique-constraint violation (e.g. duplicate workstation/tag name)
  if (err && typeof err === 'object' && (err as { code?: string }).code === 'P2002') {
    res.status(409).json({ error: 'That name already exists — pick a different one.' })
    return
  }

  if (err instanceof Error) {
    const status = (err as Error & { status?: number }).status ?? 500
    if (status === 500) console.error('[error]', err.message, err.stack)
    const message = process.env.NODE_ENV === 'production' && status === 500
      ? 'Internal server error'
      : err.message
    res.status(status).json({ error: message })
    return
  }

  res.status(500).json({ error: 'Internal server error' })
}

export function notFound(_req: Request, res: Response): void {
  res.status(404).json({ error: 'Not found' })
}
