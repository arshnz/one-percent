import { prisma } from './prisma.js'

export async function assertWorkstation(wsId: string, userId: string) {
  // Defence in depth: an undefined userId would make Prisma drop the
  // ownership filter entirely, matching any user's workstation.
  if (!wsId || !userId) {
    throw Object.assign(new Error('Not authenticated'), { status: 401 })
  }
  const ws = await prisma.workstation.findFirst({
    where: { id: wsId, userId, deletedAt: null },
  })
  if (!ws) {
    const err = Object.assign(new Error('Workstation not found'), { status: 404 })
    throw err
  }
  return ws
}
