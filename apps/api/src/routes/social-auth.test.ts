import { describe, it, expect, vi, beforeEach } from 'vitest'
import { buildApp } from '../server.js'

const CLIENT_UUID = 'aa000000-0000-0000-0000-000000000001'
const WS_UUID     = 'cc000000-0000-0000-0000-000000000001'

const prismaMock = vi.hoisted(() => ({
  workspaceMember: { findFirst: vi.fn(), findUnique: vi.fn(), findMany: vi.fn(), create: vi.fn(), update: vi.fn(), delete: vi.fn() },
  client:          { findFirst: vi.fn(), findMany: vi.fn(), create: vi.fn(), update: vi.fn() },
  workspace:       { findUnique: vi.fn(), findUniqueOrThrow: vi.fn(), create: vi.fn(), update: vi.fn() },
  user:            { findUnique: vi.fn(), findUniqueOrThrow: vi.fn() },
  socialAccount:   { findFirst: vi.fn(), upsert: vi.fn() },
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
  thumbnailQueue: { add: vi.fn() },
  publicationQueue: { add: vi.fn() },
}))
vi.mock('../lib/publishers/youtube.js', () => ({
  getYoutubeAuthUrl: vi.fn().mockImplementation((state: string) =>
    `https://accounts.google.com/oauth?state=${encodeURIComponent(state)}`
  ),
  exchangeYoutubeCode: vi.fn(),
}))

const ownerMember = { role: 'OWNER', workspace: { accountType: 'AGENCY', deletedAt: null } }

beforeEach(() => {
  vi.clearAllMocks()
  prismaMock.auditLog.create.mockResolvedValue({})
})

describe('GET /social-auth/youtube/connect', () => {
  it('retorna authUrl para client valido do workspace', async () => {
    prismaMock.workspaceMember.findFirst.mockResolvedValue(ownerMember)
    prismaMock.client.findFirst.mockResolvedValue({ id: CLIENT_UUID, workspaceId: WS_UUID })

    const app = await buildApp()
    const token = app.jwt.sign({ id: 'user-1' })

    const res = await app.inject({
      method: 'GET',
      url: `/social-auth/youtube/connect?clientId=${CLIENT_UUID}`,
      headers: { authorization: `Bearer ${token}`, 'x-workspace-id': WS_UUID },
    })

    expect(res.statusCode).toBe(200)
    expect(res.json().authUrl).toContain('accounts.google.com')
  })

  it('retorna 404 se client nao pertence ao workspace', async () => {
    prismaMock.workspaceMember.findFirst.mockResolvedValue(ownerMember)
    prismaMock.client.findFirst.mockResolvedValue(null)

    const app = await buildApp()
    const token = app.jwt.sign({ id: 'user-1' })

    const res = await app.inject({
      method: 'GET',
      url: `/social-auth/youtube/connect?clientId=${CLIENT_UUID}`,
      headers: { authorization: `Bearer ${token}`, 'x-workspace-id': WS_UUID },
    })

    expect(res.statusCode).toBe(404)
  })

  it('retorna 401 sem JWT', async () => {
    const app = await buildApp()

    const res = await app.inject({
      method: 'GET',
      url: `/social-auth/youtube/connect?clientId=${CLIENT_UUID}`,
      headers: { 'x-workspace-id': WS_UUID },
    })

    expect(res.statusCode).toBe(401)
  })
})

describe('GET /social-auth/youtube/callback', () => {
  it('retorna 400 se state for invalido', async () => {
    const app = await buildApp()

    const res = await app.inject({
      method: 'GET',
      url: '/social-auth/youtube/callback?code=someCode&state=invalid-state',
    })

    expect(res.statusCode).toBe(400)
    expect(res.json().error).toBe('INVALID_STATE')
  })

  it('retorna 400 se OAuth retornar erro', async () => {
    const app = await buildApp()

    const res = await app.inject({
      method: 'GET',
      url: '/social-auth/youtube/callback?code=x&state=x&error=access_denied',
    })

    expect(res.statusCode).toBe(400)
    expect(res.json().error).toBe('OAUTH_DENIED')
  })

  it('redireciona para frontend apos callback bem-sucedido', async () => {
    // Prepara: primeiro gera um state valido via /connect
    prismaMock.workspaceMember.findFirst.mockResolvedValue(ownerMember)
    prismaMock.client.findFirst.mockResolvedValue({ id: CLIENT_UUID, workspaceId: WS_UUID })

    const app = await buildApp()
    const token = app.jwt.sign({ id: 'user-1' })

    // Pega o state gerado pela rota /connect
    const connectRes = await app.inject({
      method: 'GET',
      url: `/social-auth/youtube/connect?clientId=${CLIENT_UUID}`,
      headers: { authorization: `Bearer ${token}`, 'x-workspace-id': WS_UUID },
    })
    const authUrl = connectRes.json().authUrl as string
    const stateMatch = authUrl.match(/state=([^&]+)/)
    const state = stateMatch ? decodeURIComponent(stateMatch[1]) : null
    expect(state).not.toBeNull()

    // Mock do exchangeYoutubeCode
    const { exchangeYoutubeCode } = await import('../lib/publishers/youtube.js')
    ;(exchangeYoutubeCode as ReturnType<typeof vi.fn>).mockResolvedValueOnce({
      accessToken: 'acc',
      refreshToken: 'ref',
      expiresAt: new Date(Date.now() + 3600_000),
      channelId: 'UC_xyz',
      handle: '@mychannel',
    })
    prismaMock.socialAccount.upsert.mockResolvedValue({ id: 'sa-1', handle: '@mychannel' })

    const callbackRes = await app.inject({
      method: 'GET',
      url: `/social-auth/youtube/callback?code=valid-code&state=${encodeURIComponent(state!)}`,
    })

    expect(callbackRes.statusCode).toBe(302)
    expect(callbackRes.headers.location).toContain('connected=youtube')
  })
})
