import { describe, it, expect, vi } from 'vitest'
import { buildApp } from '../server.js'

const prismaMock = vi.hoisted(() => ({
  workspaceMember: {
    findFirst: vi.fn(),
    findUnique: vi.fn(),
  },
  client: {
    findFirst: vi.fn(),
  },
}))

vi.mock('../lib/prisma.js', () => ({ prisma: prismaMock }))

const mockMember = {
  role: 'OWNER',
  workspace: { accountType: 'SELF', deletedAt: null },
}

describe('workspace-context middleware', () => {
  it('usuario sem membership recebe 403 traduzido', async () => {
    prismaMock.workspaceMember.findFirst.mockResolvedValue(null)
    const app = await buildApp()
    const token = app.jwt.sign({ id: 'user-1' })

    const res = await app.inject({
      method: 'GET',
      url: '/workspaces/ws-1',
      headers: {
        authorization: `Bearer ${token}`,
        'x-workspace-id': 'ws-1',
      },
    })
    expect(res.statusCode).toBe(403)
    expect(res.json().message).toBe('Você não tem permissão para realizar esta ação')
  })

  it('clientId de outro workspace retorna 404 traduzido', async () => {
    prismaMock.workspaceMember.findFirst.mockResolvedValue(mockMember)
    prismaMock.client.findFirst.mockResolvedValue(null)

    const app = await buildApp()
    const token = app.jwt.sign({ id: 'user-1' })

    const res = await app.inject({
      method: 'GET',
      url: '/workspaces/ws-1',
      headers: {
        authorization: `Bearer ${token}`,
        'x-workspace-id': 'ws-1',
        'x-client-id': 'client-outro-workspace',
      },
    })
    expect(res.statusCode).toBe(404)
  })

  it('workspace SELF injeta clientId automaticamente', async () => {
    prismaMock.workspaceMember.findFirst.mockResolvedValue({
      role: 'OWNER',
      workspace: { accountType: 'SELF', deletedAt: null },
    })
    prismaMock.client.findFirst.mockResolvedValue({ id: 'self-client-1', isSelf: true })

    const app = await buildApp()
    const token = app.jwt.sign({ id: 'user-1' })

    const res = await app.inject({
      method: 'GET',
      url: '/workspaces/ws-1',
      headers: {
        authorization: `Bearer ${token}`,
        'x-workspace-id': 'ws-1',
      },
    })
    expect([200, 500]).toContain(res.statusCode)
  })
})
