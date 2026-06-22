import { describe, it, expect, vi, beforeEach } from 'vitest'
import { runDataDeletionJob } from './data-deletion.job.js'

const prismaMock = vi.hoisted(() => ({
  dataDeletionRequest: {
    findMany: vi.fn(),
    update: vi.fn(),
  },
  refreshToken: { updateMany: vi.fn() },
  workspaceMember: { findMany: vi.fn() },
  client: { findMany: vi.fn(), update: vi.fn() },
  socialAccount: { updateMany: vi.fn() },
  workspace: { update: vi.fn() },
  user: { update: vi.fn() },
  auditLog: { create: vi.fn(), findMany: vi.fn() },
}))

vi.mock('../lib/prisma.js', () => ({ prisma: prismaMock }))

const now = Date.now()

beforeEach(() => {
  vi.clearAllMocks()
  prismaMock.refreshToken.updateMany.mockResolvedValue({ count: 0 })
  prismaMock.workspaceMember.findMany.mockResolvedValue([])
  prismaMock.auditLog.create.mockResolvedValue({})
  prismaMock.dataDeletionRequest.update.mockResolvedValue({})
  prismaMock.user.update.mockResolvedValue({})
})

describe('runDataDeletionJob', () => {
  it('solicitacao com menos de 30 dias nao e processada', async () => {
    prismaMock.dataDeletionRequest.findMany.mockResolvedValue([])

    await runDataDeletionJob()

    expect(prismaMock.user.update).not.toHaveBeenCalled()
  })

  it('solicitacao com mais de 30 dias anonimiza o usuario corretamente', async () => {
    const userId = 'user-delete-1'
    prismaMock.dataDeletionRequest.findMany.mockResolvedValue([{
      id: 'req-1',
      userId,
      requestedAt: new Date(now - 31 * 24 * 60 * 60 * 1000),
    }])

    await runDataDeletionJob()

    expect(prismaMock.dataDeletionRequest.update).toHaveBeenCalledWith(
      expect.objectContaining({ data: expect.objectContaining({ status: 'PROCESSING' }) })
    )
    expect(prismaMock.user.update).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { id: userId },
        data: expect.objectContaining({
          email: `deleted_${userId}@deleted.invalid`,
          name: 'Usuario removido',
          passwordHash: 'DELETED',
          twoFaSecret: null,
        }),
      })
    )
    expect(prismaMock.dataDeletionRequest.update).toHaveBeenCalledWith(
      expect.objectContaining({ data: expect.objectContaining({ status: 'COMPLETED' }) })
    )
  })

  it('AuditLog nao e deletado apos anonimizacao', async () => {
    const userId = 'user-delete-2'
    prismaMock.dataDeletionRequest.findMany.mockResolvedValue([{
      id: 'req-2',
      userId,
      requestedAt: new Date(now - 31 * 24 * 60 * 60 * 1000),
    }])

    await runDataDeletionJob()

    expect(prismaMock.auditLog.create).toHaveBeenCalledWith(
      expect.objectContaining({ data: expect.objectContaining({ action: 'gdpr.deletionCompleted' }) })
    )
    // auditLog.delete nunca é chamado
    expect(prismaMock.auditLog).not.toHaveProperty('delete')
  })
})
