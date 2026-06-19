import { prisma } from '../lib/prisma.js'

const GRACE_PERIOD_DAYS = 30

export async function runDataDeletionJob(): Promise<void> {
  const cutoff = new Date(Date.now() - GRACE_PERIOD_DAYS * 24 * 60 * 60 * 1000)

  const requests = await prisma.dataDeletionRequest.findMany({
    where: { status: 'PENDING', requestedAt: { lt: cutoff } },
  })

  for (const req of requests) {
    await processRequest(req.id, req.userId)
  }
}

async function processRequest(requestId: string, userId: string): Promise<void> {
  await prisma.dataDeletionRequest.update({
    where: { id: requestId },
    data: { status: 'PROCESSING' },
  })

  try {
    await prisma.refreshToken.updateMany({
      where: { userId, revokedAt: null },
      data: { revokedAt: new Date() },
    })

    const memberships = await prisma.workspaceMember.findMany({ where: { userId, role: 'OWNER' } })

    for (const membership of memberships) {
      const clients = await prisma.client.findMany({
        where: { workspaceId: membership.workspaceId, deletedAt: null },
      })
      for (const client of clients) {
        await prisma.socialAccount.updateMany({
          where: { clientId: client.id },
          data: { needsReauth: true },
        })
        await prisma.client.update({
          where: { id: client.id },
          data: { deletedAt: new Date() },
        })
      }
      await prisma.workspace.update({
        where: { id: membership.workspaceId },
        data: { deletedAt: new Date() },
      })
    }

    await prisma.user.update({
      where: { id: userId },
      data: {
        email: `deleted_${userId}@deleted.invalid`,
        name: 'Usuario removido',
        passwordHash: 'DELETED',
        twoFaSecret: null,
        twoFaBackupCodes: [],
        locale: 'pt-BR',
        deletedAt: new Date(),
      },
    })

    await prisma.dataDeletionRequest.update({
      where: { id: requestId },
      data: { status: 'COMPLETED', completedAt: new Date() },
    })

    await prisma.auditLog.create({
      data: { userId, action: 'gdpr.deletionCompleted', metadata: { requestId } },
    })
  } catch (err) {
    await prisma.dataDeletionRequest.update({
      where: { id: requestId },
      data: { status: 'PENDING' },
    })
    throw err
  }
}
