import { describe, it, expect, vi, beforeEach } from 'vitest'
import { buildApp } from '../server.js'

const SA_UUID    = 'aa000000-0000-0000-0000-000000000001'
const POST_UUID  = 'bb000000-0000-0000-0000-000000000001'
const WS_UUID    = 'cc000000-0000-0000-0000-000000000001'
const MEDIA_UUID = 'dd000000-0000-0000-0000-000000000001'

const prismaMock = vi.hoisted(() => ({
  workspaceMember: { findFirst: vi.fn(), findUnique: vi.fn(), findMany: vi.fn(), create: vi.fn(), update: vi.fn(), delete: vi.fn() },
  client:          { findFirst: vi.fn(), findMany: vi.fn(), create: vi.fn(), update: vi.fn() },
  workspace:       { findUnique: vi.fn(), findUniqueOrThrow: vi.fn(), create: vi.fn(), update: vi.fn() },
  user:            { findUnique: vi.fn(), findUniqueOrThrow: vi.fn() },
  socialAccount:   { findFirst: vi.fn() },
  mediaFile:       { findFirst: vi.fn(), create: vi.fn(), findMany: vi.fn(), update: vi.fn() },
  post:            { create: vi.fn(), findMany: vi.fn(), findFirst: vi.fn(), update: vi.fn(), count: vi.fn() },
  auditLog:        { create: vi.fn() },
  consentRecord:   { create: vi.fn(), updateMany: vi.fn(), createMany: vi.fn() },
  refreshToken:    { create: vi.fn(), findUnique: vi.fn(), updateMany: vi.fn() },
  passwordResetToken: { findUnique: vi.fn() },
  dataDeletionRequest: { findFirst: vi.fn() },
  $transaction:    vi.fn(),
}))

vi.mock('../lib/prisma.js', () => ({ prisma: prismaMock }))
vi.mock('../lib/queue.js', () => ({
  thumbnailQueue:   { add: vi.fn().mockResolvedValue({}) },
  publicationQueue: { add: vi.fn().mockResolvedValue({ id: 'job-123' }) },
}))

const ownerMember = { role: 'OWNER', workspace: { accountType: 'AGENCY', deletedAt: null } }

beforeEach(() => {
  vi.clearAllMocks()
  prismaMock.auditLog.create.mockResolvedValue({})
  prismaMock.client.findFirst.mockResolvedValue(null)
})

describe('POST /workspaces/:workspaceId/posts', () => {
  it('cria post agendado e enfileira job com delay', async () => {
    prismaMock.workspaceMember.findFirst.mockResolvedValue(ownerMember)
    prismaMock.socialAccount.findFirst.mockResolvedValue({
      id: SA_UUID, clientId: 'c-1', platform: 'YOUTUBE',
    })
    prismaMock.post.create.mockResolvedValue({
      id: POST_UUID, platform: 'YOUTUBE', status: 'SCHEDULED',
      scheduledAt: new Date('2099-01-01T10:00:00Z'), caption: 'Olá mundo',
    })
    prismaMock.post.update.mockResolvedValue({})

    const app = await buildApp()
    const token = app.jwt.sign({ id: 'user-1' })

    const res = await app.inject({
      method: 'POST',
      url: `/workspaces/${WS_UUID}/posts`,
      headers: { authorization: `Bearer ${token}`, 'x-workspace-id': WS_UUID },
      payload: {
        socialAccountId: SA_UUID,
        caption: 'Olá mundo',
        scheduledAt: '2099-01-01T10:00:00Z',
      },
    })

    expect(res.statusCode).toBe(201)
    expect(res.json().status).toBe('SCHEDULED')
  })

  it('retorna 404 se socialAccount nao pertence ao workspace', async () => {
    prismaMock.workspaceMember.findFirst.mockResolvedValue(ownerMember)
    prismaMock.socialAccount.findFirst.mockResolvedValue(null)

    const app = await buildApp()
    const token = app.jwt.sign({ id: 'user-1' })

    const res = await app.inject({
      method: 'POST',
      url: `/workspaces/${WS_UUID}/posts`,
      headers: { authorization: `Bearer ${token}`, 'x-workspace-id': WS_UUID },
      payload: { socialAccountId: SA_UUID, caption: 'Test', scheduledAt: '2099-01-01T10:00:00Z' },
    })

    expect(res.statusCode).toBe(404)
  })

  it('retorna 404 se mediaFile nao esta READY', async () => {
    prismaMock.workspaceMember.findFirst.mockResolvedValue(ownerMember)
    prismaMock.socialAccount.findFirst.mockResolvedValue({
      id: SA_UUID, clientId: 'c-1', platform: 'YOUTUBE',
    })
    prismaMock.mediaFile.findFirst.mockResolvedValue(null)

    const app = await buildApp()
    const token = app.jwt.sign({ id: 'user-1' })

    const res = await app.inject({
      method: 'POST',
      url: `/workspaces/${WS_UUID}/posts`,
      headers: { authorization: `Bearer ${token}`, 'x-workspace-id': WS_UUID },
      payload: {
        socialAccountId: SA_UUID,
        mediaFileId: MEDIA_UUID,
        caption: 'Test',
        scheduledAt: '2099-01-01T10:00:00Z',
      },
    })

    expect(res.statusCode).toBe(404)
  })
})

describe('GET /workspaces/:workspaceId/posts', () => {
  it('lista posts do workspace com paginacao', async () => {
    prismaMock.workspaceMember.findFirst.mockResolvedValue(ownerMember)
    prismaMock.post.findMany.mockResolvedValue([
      { id: POST_UUID, platform: 'YOUTUBE', status: 'SCHEDULED', caption: 'Test',
        scheduledAt: new Date(), publishedAt: null, failureReason: null, attempts: 0 },
    ])
    prismaMock.post.count.mockResolvedValue(1)

    const app = await buildApp()
    const token = app.jwt.sign({ id: 'user-1' })

    const res = await app.inject({
      method: 'GET',
      url: `/workspaces/${WS_UUID}/posts`,
      headers: { authorization: `Bearer ${token}`, 'x-workspace-id': WS_UUID },
    })

    expect(res.statusCode).toBe(200)
    expect(res.json().posts).toHaveLength(1)
    expect(res.json().total).toBe(1)
  })
})

describe('DELETE /workspaces/:workspaceId/posts/:postId', () => {
  it('cancela post SCHEDULED com sucesso', async () => {
    prismaMock.workspaceMember.findFirst.mockResolvedValue(ownerMember)
    prismaMock.post.findFirst.mockResolvedValue({
      id: POST_UUID, workspaceId: WS_UUID, status: 'SCHEDULED',
    })
    prismaMock.post.update.mockResolvedValue({})

    const app = await buildApp()
    const token = app.jwt.sign({ id: 'user-1' })

    const res = await app.inject({
      method: 'DELETE',
      url: `/workspaces/${WS_UUID}/posts/${POST_UUID}`,
      headers: { authorization: `Bearer ${token}`, 'x-workspace-id': WS_UUID },
    })

    expect(res.statusCode).toBe(200)
    expect(res.json().cancelled).toBe(true)
  })

  it('retorna 409 ao tentar cancelar post PUBLISHED', async () => {
    prismaMock.workspaceMember.findFirst.mockResolvedValue(ownerMember)
    prismaMock.post.findFirst.mockResolvedValue({
      id: POST_UUID, workspaceId: WS_UUID, status: 'PUBLISHED',
    })

    const app = await buildApp()
    const token = app.jwt.sign({ id: 'user-1' })

    const res = await app.inject({
      method: 'DELETE',
      url: `/workspaces/${WS_UUID}/posts/${POST_UUID}`,
      headers: { authorization: `Bearer ${token}`, 'x-workspace-id': WS_UUID },
    })

    expect(res.statusCode).toBe(409)
  })
})
