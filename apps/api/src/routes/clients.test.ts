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
  client: {
    findFirst: vi.fn(),
    findMany: vi.fn(),
    create: vi.fn(),
    update: vi.fn(),
  },
  workspace: {
    findUnique: vi.fn(),
    findUniqueOrThrow: vi.fn(),
    create: vi.fn(),
    update: vi.fn(),
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

const agencyMember = { role: 'OWNER', workspace: { accountType: 'AGENCY', deletedAt: null } }
const selfMember = { role: 'OWNER', workspace: { accountType: 'SELF', deletedAt: null } }

beforeEach(() => {
  vi.clearAllMocks()
  prismaMock.auditLog.create.mockResolvedValue({})
})

describe('POST /workspaces/:workspaceId/clients', () => {
  it('SELF bloqueado de criar client — erro traduzido', async () => {
    prismaMock.workspaceMember.findFirst.mockResolvedValue(selfMember)
    prismaMock.client.findFirst.mockResolvedValue({ id: 'self-c1', isSelf: true })

    const app = await buildApp()
    const token = app.jwt.sign({ id: 'user-1' })

    const res = await app.inject({
      method: 'POST',
      url: '/workspaces/ws-1/clients',
      headers: { authorization: `Bearer ${token}`, 'x-workspace-id': 'ws-1' },
      payload: { name: 'Novo Cliente' },
    })
    expect(res.statusCode).toBe(403)
    expect(res.json().message).toBe('Uma conta própria não pode ter clientes adicionais')
  })

  it('AGENCY OWNER cria client com sucesso', async () => {
    prismaMock.workspaceMember.findFirst.mockResolvedValue(agencyMember)
    prismaMock.client.findFirst.mockResolvedValue(null)
    const newClient = { id: 'c-new', name: 'Cliente A', workspaceId: 'ws-1', isSelf: false }
    prismaMock.client.create.mockResolvedValue(newClient)

    const app = await buildApp()
    const token = app.jwt.sign({ id: 'user-1' })

    const res = await app.inject({
      method: 'POST',
      url: '/workspaces/ws-1/clients',
      headers: { authorization: `Bearer ${token}`, 'x-workspace-id': 'ws-1' },
      payload: { name: 'Cliente A' },
    })
    expect(res.statusCode).toBe(201)
    expect(res.json().name).toBe('Cliente A')
  })

  it('AGENCY VIEWER bloqueado de criar client — 403', async () => {
    prismaMock.workspaceMember.findFirst.mockResolvedValue({
      role: 'VIEWER',
      workspace: { accountType: 'AGENCY', deletedAt: null },
    })
    prismaMock.client.findFirst.mockResolvedValue(null)

    const app = await buildApp()
    const token = app.jwt.sign({ id: 'user-1' })

    const res = await app.inject({
      method: 'POST',
      url: '/workspaces/ws-1/clients',
      headers: { authorization: `Bearer ${token}`, 'x-workspace-id': 'ws-1' },
      payload: { name: 'Cliente A' },
    })
    expect(res.statusCode).toBe(403)
  })
})

describe('DELETE /workspaces/:workspaceId/clients/:id', () => {
  it('deletar client isSelf é bloqueado', async () => {
    prismaMock.workspaceMember.findFirst.mockResolvedValue(selfMember)
    prismaMock.client.findFirst.mockResolvedValueOnce({ id: 'self-c1', isSelf: true })
      .mockResolvedValueOnce({ id: 'self-c1', isSelf: true })

    const app = await buildApp()
    const token = app.jwt.sign({ id: 'user-1' })

    const res = await app.inject({
      method: 'DELETE',
      url: '/workspaces/ws-1/clients/self-c1',
      headers: { authorization: `Bearer ${token}`, 'x-workspace-id': 'ws-1' },
    })
    expect(res.statusCode).toBe(403)
  })

  it('acesso cruzado entre workspaces retorna 404', async () => {
    prismaMock.workspaceMember.findFirst.mockResolvedValue(agencyMember)
    prismaMock.client.findFirst
      .mockResolvedValueOnce(null) // sem x-client-id = null ok
      .mockResolvedValueOnce(null) // busca do client pelo id retorna null

    const app = await buildApp()
    const token = app.jwt.sign({ id: 'user-1' })

    const res = await app.inject({
      method: 'DELETE',
      url: '/workspaces/ws-1/clients/client-outro-ws',
      headers: { authorization: `Bearer ${token}`, 'x-workspace-id': 'ws-1' },
    })
    expect(res.statusCode).toBe(404)
  })
})
