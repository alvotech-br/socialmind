import { describe, it, expect, vi, beforeEach } from 'vitest'

const prismaMock = vi.hoisted(() => ({
  socialAccount: { update: vi.fn() },
}))
vi.mock('../prisma.js', () => ({ prisma: prismaMock }))

const fetchMock = vi.fn()
vi.stubGlobal('fetch', fetchMock)

import { getTiktokAuthUrl, exchangeTiktokCode, publishToTiktok } from './tiktok.js'

beforeEach(() => {
  vi.clearAllMocks()
  process.env.TIKTOK_CLIENT_KEY = 'test-client-key'
  process.env.TIKTOK_CLIENT_SECRET = 'test-client-secret'
  process.env.TIKTOK_REDIRECT_URI = 'http://localhost:3001/social-auth/tiktok/callback'
})

describe('getTiktokAuthUrl', () => {
  it('retorna URL de autorizacao do TikTok com o state', () => {
    const url = getTiktokAuthUrl('ws:client:123')

    expect(url).toContain('tiktok.com')
    expect(url).toContain('state=ws%3Aclient%3A123')
    expect(url).toContain('client_key=test-client-key')
  })
})

describe('exchangeTiktokCode', () => {
  it('troca code por tokens e retorna dados do usuario', async () => {
    fetchMock
      .mockResolvedValueOnce({
        ok: true,
        json: async () => ({
          data: {
            access_token: 'acc-tok',
            refresh_token: 'ref-tok',
            expires_in: 86400,
            open_id: 'tt-open-id-123',
          },
        }),
      })
      .mockResolvedValueOnce({
        ok: true,
        json: async () => ({
          data: { user: { display_name: '@tiktoker' } },
        }),
      })

    const result = await exchangeTiktokCode('auth-code')

    expect(result.accessToken).toBe('acc-tok')
    expect(result.refreshToken).toBe('ref-tok')
    expect(result.openId).toBe('tt-open-id-123')
    expect(result.handle).toBe('@tiktoker')
    expect(result.expiresAt).toBeInstanceOf(Date)
  })

  it('lanca erro se API retornar falha', async () => {
    fetchMock.mockResolvedValueOnce({
      ok: false,
      json: async () => ({ error: 'invalid_grant', error_description: 'Code expirado' }),
    })

    await expect(exchangeTiktokCode('bad-code')).rejects.toThrow('Code expirado')
  })
})

describe('publishToTiktok', () => {
  const baseParams = {
    caption: 'Meu video incrivel',
    accessToken: 'acc-tok',
    refreshToken: 'ref-tok',
    platformUserId: '@meucanal',
    socialAccountId: 'aa000000-0000-0000-0000-000000000001',
    videoUrl: 'https://s3.example.com/videos/test.mp4',
  }

  it('publica video via PULL_FROM_URL e retorna PUBLISH_COMPLETE', async () => {
    // refresh token (tenta renovar)
    fetchMock
      .mockResolvedValueOnce({
        ok: true,
        json: async () => ({
          data: { access_token: 'new-acc', refresh_token: 'new-ref', expires_in: 86400 },
        }),
      })
      // init publish
      .mockResolvedValueOnce({
        ok: true,
        json: async () => ({ data: { publish_id: 'pub-id-123' } }),
      })
      // status check
      .mockResolvedValueOnce({
        ok: true,
        json: async () => ({
          data: { status: 'PUBLISH_COMPLETE', publicaly_available_post_id: ['vid-456'] },
        }),
      })

    const result = await publishToTiktok(baseParams)

    expect(result.platformPostId).toBe('pub-id-123')
    expect(result.publishedUrl).toContain('vid-456')
  })

  it('lanca erro se video ainda esta sendo processado (BullMQ faz retry)', async () => {
    fetchMock
      .mockResolvedValueOnce({
        ok: true,
        json: async () => ({
          data: { access_token: 'tok', refresh_token: 'ref', expires_in: 86400 },
        }),
      })
      .mockResolvedValueOnce({
        ok: true,
        json: async () => ({ data: { publish_id: 'pub-id-123' } }),
      })
      .mockResolvedValueOnce({
        ok: true,
        json: async () => ({ data: { status: 'PROCESSING_UPLOAD' } }),
      })

    await expect(publishToTiktok(baseParams)).rejects.toThrow('ainda sendo processado')
  })

  it('lanca erro se videoUrl nao for fornecida', async () => {
    // eslint-disable-next-line @typescript-eslint/no-unused-vars
    const { videoUrl: _url, ...withoutUrl } = baseParams
    await expect(publishToTiktok(withoutUrl)).rejects.toThrow('videoUrl')
  })

  it('lanca erro se API retornar falha no init', async () => {
    fetchMock
      .mockResolvedValueOnce({
        ok: true,
        json: async () => ({
          data: { access_token: 'tok', refresh_token: 'ref', expires_in: 86400 },
        }),
      })
      .mockResolvedValueOnce({
        ok: false,
        json: async () => ({ error: { code: 'SPAM_RISK', message: 'Spam detectado' } }),
      })

    await expect(publishToTiktok(baseParams)).rejects.toThrow('Spam detectado')
  })
})
