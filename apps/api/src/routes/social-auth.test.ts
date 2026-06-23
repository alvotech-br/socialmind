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
vi.mock('../lib/publishers/tiktok.js', () => ({
  getTiktokAuthUrl: vi.fn().mockImplementation((state: string) =>
    `https://www.tiktok.com/v2/auth/authorize/?state=${encodeURIComponent(state)}`
  ),
  exchangeTiktokCode: vi.fn(),
}))
vi.mock('../lib/publishers/instagram.js', () => ({
  getInstagramAuthUrl: vi.fn().mockImplementation((state: string) =>
    `https://www.facebook.com/v19.0/dialog/oauth?state=${encodeURIComponent(state)}`
  ),
  exchangeInstagramCode: vi.fn(),
}))

const ownerMember = { role: 'OWNER', workspace: { accountType: 'AGENCY', deletedAt: null } }

beforeEach(() => {
  vi.clearAllMocks()
  prismaMock.auditLog.create.mockResolvedValue({})
  prismaMock.socialAccount.upsert.mockResolvedValue({ id: 'sa-1' })
})

// ── helper para gerar state válido via /connect ────────────────────────────────
async function getValidState(
  app: Awaited<ReturnType<typeof buildApp>>,
  platform: 'youtube' | 'tiktok' | 'instagram',
) {
  prismaMock.workspaceMember.findFirst.mockResolvedValue(ownerMember)
  prismaMock.client.findFirst.mockResolvedValue({ id: CLIENT_UUID, workspaceId: WS_UUID })

  const token = app.jwt.sign({ id: 'user-1' })
  const connectRes = await app.inject({
    method: 'GET',
    url: `/social-auth/${platform}/connect?clientId=${CLIENT_UUID}`,
    headers: { authorization: `Bearer ${token}`, 'x-workspace-id': WS_UUID },
  })

  const authUrl = connectRes.json().authUrl as string
  const stateMatch = authUrl.match(/state=([^&]+)/)
  return stateMatch ? decodeURIComponent(stateMatch[1]) : null
}

// ── YouTube ───────────────────────────────────────────────────────────────────

describe('GET /social-auth/youtube/connect', () => {
  it('retorna authUrl para client valido', async () => {
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
  it('retorna 400 se state invalido', async () => {
    const app = await buildApp()
    const res = await app.inject({
      method: 'GET',
      url: '/social-auth/youtube/callback?code=code&state=invalid',
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
    const app = await buildApp()
    const state = await getValidState(app, 'youtube')
    expect(state).not.toBeNull()

    const { exchangeYoutubeCode } = await import('../lib/publishers/youtube.js')
    ;(exchangeYoutubeCode as ReturnType<typeof vi.fn>).mockResolvedValueOnce({
      accessToken: 'acc', refreshToken: 'ref',
      expiresAt: new Date(Date.now() + 3600_000),
      channelId: 'UC_xyz', handle: '@mychannel',
    })

    const res = await app.inject({
      method: 'GET',
      url: `/social-auth/youtube/callback?code=valid&state=${encodeURIComponent(state!)}`,
    })

    expect(res.statusCode).toBe(302)
    expect(res.headers.location).toContain('connected=youtube')
  })
})

// ── TikTok ────────────────────────────────────────────────────────────────────

describe('GET /social-auth/tiktok/connect', () => {
  it('retorna authUrl do TikTok para client valido', async () => {
    prismaMock.workspaceMember.findFirst.mockResolvedValue(ownerMember)
    prismaMock.client.findFirst.mockResolvedValue({ id: CLIENT_UUID, workspaceId: WS_UUID })

    const app = await buildApp()
    const token = app.jwt.sign({ id: 'user-1' })

    const res = await app.inject({
      method: 'GET',
      url: `/social-auth/tiktok/connect?clientId=${CLIENT_UUID}`,
      headers: { authorization: `Bearer ${token}`, 'x-workspace-id': WS_UUID },
    })

    expect(res.statusCode).toBe(200)
    expect(res.json().authUrl).toContain('tiktok.com')
  })
})

describe('GET /social-auth/tiktok/callback', () => {
  it('retorna 400 se state invalido', async () => {
    const app = await buildApp()
    const res = await app.inject({
      method: 'GET',
      url: '/social-auth/tiktok/callback?code=x&state=invalid',
    })
    expect(res.statusCode).toBe(400)
    expect(res.json().error).toBe('INVALID_STATE')
  })

  it('redireciona para frontend apos callback bem-sucedido', async () => {
    const app = await buildApp()
    const state = await getValidState(app, 'tiktok')
    expect(state).not.toBeNull()

    const { exchangeTiktokCode } = await import('../lib/publishers/tiktok.js')
    ;(exchangeTiktokCode as ReturnType<typeof vi.fn>).mockResolvedValueOnce({
      accessToken: 'tt-acc', refreshToken: 'tt-ref',
      expiresAt: new Date(Date.now() + 86400_000),
      openId: 'tt-open-123', handle: '@tiktoker',
    })

    const res = await app.inject({
      method: 'GET',
      url: `/social-auth/tiktok/callback?code=valid&state=${encodeURIComponent(state!)}`,
    })

    expect(res.statusCode).toBe(302)
    expect(res.headers.location).toContain('connected=tiktok')
  })
})

// ── Instagram ─────────────────────────────────────────────────────────────────

describe('GET /social-auth/instagram/connect', () => {
  it('retorna authUrl do Meta para client valido', async () => {
    prismaMock.workspaceMember.findFirst.mockResolvedValue(ownerMember)
    prismaMock.client.findFirst.mockResolvedValue({ id: CLIENT_UUID, workspaceId: WS_UUID })

    const app = await buildApp()
    const token = app.jwt.sign({ id: 'user-1' })

    const res = await app.inject({
      method: 'GET',
      url: `/social-auth/instagram/connect?clientId=${CLIENT_UUID}`,
      headers: { authorization: `Bearer ${token}`, 'x-workspace-id': WS_UUID },
    })

    expect(res.statusCode).toBe(200)
    expect(res.json().authUrl).toContain('facebook.com')
  })
})

describe('GET /social-auth/instagram/callback', () => {
  it('retorna 400 se state invalido', async () => {
    const app = await buildApp()
    const res = await app.inject({
      method: 'GET',
      url: '/social-auth/instagram/callback?code=x&state=invalid',
    })
    expect(res.statusCode).toBe(400)
    expect(res.json().error).toBe('INVALID_STATE')
  })

  it('redireciona para frontend apos callback bem-sucedido', async () => {
    const app = await buildApp()
    const state = await getValidState(app, 'instagram')
    expect(state).not.toBeNull()

    const { exchangeInstagramCode } = await import('../lib/publishers/instagram.js')
    ;(exchangeInstagramCode as ReturnType<typeof vi.fn>).mockResolvedValueOnce({
      accessToken: 'ig-acc',
      expiresAt: new Date(Date.now() + 5184000_000),
      igUserId: 'ig-user-123', handle: 'meuig',
    })

    const res = await app.inject({
      method: 'GET',
      url: `/social-auth/instagram/callback?code=valid&state=${encodeURIComponent(state!)}`,
    })

    expect(res.statusCode).toBe(302)
    expect(res.headers.location).toContain('connected=instagram')
  })
})
