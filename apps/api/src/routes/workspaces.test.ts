import { describe, it, expect, vi, beforeEach } from 'vitest'
import { buildApp } from '../server.js'

const prismaMock = vi.hoisted(() => ({
  workspaceMember: {
    findFirst: vi.fn(),
    findUnique: vi.fn(),
    findMany: vi.fn(),
    create: vi.fn(),
    update: vi.fn(),
    delete: vi.fn(),
  },
  workspace: {
    findUnique: vi.fn(),
    findUniqueOrThrow: vi.fn(),
    create: vi.fn(),
    update: vi.fn(),
  },
  client: {
    findFirst: vi.fn(),
    findMany: vi.fn(),
    create: vi.fn(),
  },
  user: {
    findUnique: vi.fn(),
    findUniqueOrThrow: vi.fn(),
  },
  auditLog: { create: vi.fn() },
  consentRecord: { create: vi.fn(), updateMany: vi.fn(), createMany: vi.fn() },
  refreshToken: { create: vi.fn(), findUnique: vi.fn(), updateMany: vi.fn() },
  passwordResetToken: { findUnique: vi.fn() },
  dataDeletionRequest: { findFirst: vi.fn() },
  $transaction: vi.fn(),
}))

vi.mock('../lib/prisma.js', () => ({ prisma: prismaMock }))

const ownerMember = { role: 'OWNER', workspace: { accountType: 'AGENCY', deletedAt: null } }
const viewerMember = { role: 'VIEWER', workspace: { accountType: 'AGENCY', deletedAt: null } }

beforeEach(() => {
  vi.clearAllMocks()
  prismaMock.auditLog.create.mockResolvedValue({})
  prismaMock.client.findFirst.mockResolvedValue(null)
})

describe('PATCH /workspaces/:workspaceId', () => {
  it('VIEWER editando workspace retorna 403 traduzido', async () => {
    prismaMock.workspaceMember.findFirst.mockResolvedValue(viewerMember)

    const app = await buildApp()
    const token = app.jwt.sign({ id: 'user-1' })

    const res = await app.inject({
      method: 'PATCH',
      url: '/workspaces/ws-1',
      headers: { authorization: `Bearer ${token}`, 'x-workspace-id': 'ws-1' },
      payload: { name: 'Novo Nome' },
    })
    expect(res.statusCode).toBe(403)
    expect(res.json().message).toBe('Você não tem permissão para realizar esta ação')
  })

  it('OWNER edita workspace com sucesso', async () => {
    prismaMock.workspaceMember.findFirst.mockResolvedValue(ownerMember)
    prismaMock.workspace.update.mockResolvedValue({ id: 'ws-1', name: 'Novo Nome' })

    const app = await buildApp()
    const token = app.jwt.sign({ id: 'user-1' })

    const res = await app.inject({
      method: 'PATCH',
      url: '/workspaces/ws-1',
      headers: { authorization: `Bearer ${token}`, 'x-workspace-id': 'ws-1' },
      payload: { name: 'Novo Nome' },
    })
    expect(res.statusCode).toBe(200)
  })
})

describe('DELETE /workspaces/:workspaceId/members/:userId', () => {
  it('remover membro OWNER e bloqueado', async () => {
    prismaMock.workspaceMember.findFirst.mockResolvedValue(ownerMember)
    prismaMock.workspaceMember.findUnique.mockResolvedValue({ role: 'OWNER', userId: 'user-2' })

    const app = await buildApp()
    const token = app.jwt.sign({ id: 'user-1' })

    const res = await app.inject({
      method: 'DELETE',
      url: '/workspaces/ws-1/members/user-2',
      headers: { authorization: `Bearer ${token}`, 'x-workspace-id': 'ws-1' },
    })
    expect(res.statusCode).toBe(403)
  })

  it('remover membro VIEWER com sucesso', async () => {
    prismaMock.workspaceMember.findFirst.mockResolvedValue(ownerMember)
    prismaMock.workspaceMember.findUnique.mockResolvedValue({ role: 'VIEWER', userId: 'user-2' })
    prismaMock.workspaceMember.delete.mockResolvedValue({})

    const app = await buildApp()
    const token = app.jwt.sign({ id: 'user-1' })

    const res = await app.inject({
      method: 'DELETE',
      url: '/workspaces/ws-1/members/user-2',
      headers: { authorization: `Bearer ${token}`, 'x-workspace-id': 'ws-1' },
    })
    expect(res.statusCode).toBe(204)
  })
})
