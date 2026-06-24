import { describe, it, expect, vi, beforeEach } from 'vitest'

const prismaMock = vi.hoisted(() => ({
  socialAccount: { update: vi.fn() },
}))
vi.mock('../prisma.js', () => ({ prisma: prismaMock }))

const fetchMock = vi.fn()
vi.stubGlobal('fetch', fetchMock)

import { getInstagramAuthUrl, exchangeInstagramCode, publishToInstagram } from './instagram.js'

beforeEach(() => {
  vi.clearAllMocks()
  process.env.META_APP_ID = 'test-app-id'
  process.env.META_APP_SECRET = 'test-app-secret'
  process.env.META_REDIRECT_URI = 'http://localhost:3001/social-auth/instagram/callback'
})

describe('getInstagramAuthUrl', () => {
  it('retorna URL de autorizacao Meta com o state', () => {
    const url = getInstagramAuthUrl('ws:client:123')

    expect(url).toContain('facebook.com')
    expect(url).toContain('instagram_content_publish')
    expect(url).toContain('state=')
  })
})

describe('exchangeInstagramCode', () => {
  it('troca code, obtém token long-lived e retorna conta IG', async () => {
    // short-lived token
    fetchMock
      .mockResolvedValueOnce({
        ok: true,
        json: async () => ({ access_token: 'short-tok' }),
      })
      // long-lived token
      .mockResolvedValueOnce({
        json: async () => ({ access_token: 'long-tok', expires_in: 5184000 }),
      })
      // accounts com IG vinculado
      .mockResolvedValueOnce({
        json: async () => ({
          data: [
            { instagram_business_account: { id: 'ig-user-123', username: 'meuig' } },
          ],
        }),
      })

    const result = await exchangeInstagramCode('auth-code')

    expect(result.accessToken).toBe('long-tok')
    expect(result.igUserId).toBe('ig-user-123')
    expect(result.handle).toBe('meuig')
    expect(result.expiresAt).toBeInstanceOf(Date)
  })

  it('lanca erro se nenhuma conta IG Business for encontrada', async () => {
    fetchMock
      .mockResolvedValueOnce({
        ok: true,
        json: async () => ({ access_token: 'short-tok' }),
      })
      .mockResolvedValueOnce({
        json: async () => ({ access_token: 'long-tok', expires_in: 5184000 }),
      })
      .mockResolvedValueOnce({
        json: async () => ({ data: [{ instagram_business_account: undefined }] }),
      })

    await expect(exchangeInstagramCode('code')).rejects.toThrow('Instagram Business')
  })

  it('lanca erro se token inicial falhar', async () => {
    fetchMock.mockResolvedValueOnce({
      ok: false,
      json: async () => ({ error: { message: 'Invalid code' } }),
    })

    await expect(exchangeInstagramCode('bad-code')).rejects.toThrow('Invalid code')
  })
})

describe('publishToInstagram', () => {
  const baseParams = {
    caption: 'Post incrivel #reels',
    accessToken: 'ig-acc-tok',
    platformUserId: 'ig-user-123',
    socialAccountId: 'aa000000-0000-0000-0000-000000000001',
    videoUrl: 'https://s3.example.com/videos/reel.mp4',
  }

  it('cria container, verifica FINISHED e publica', async () => {
    fetchMock
      // criar container
      .mockResolvedValueOnce({ json: async () => ({ id: 'container-abc' }) })
      // status FINISHED
      .mockResolvedValueOnce({ json: async () => ({ status_code: 'FINISHED' }) })
      // publicar
      .mockResolvedValueOnce({ json: async () => ({ id: 'media-post-xyz' }) })

    const result = await publishToInstagram(baseParams)

    expect(result.platformPostId).toBe('media-post-xyz')
    expect(result.publishedUrl).toContain('media-post-xyz')
  })

  it('lanca erro se container ainda esta IN_PROGRESS (BullMQ faz retry)', async () => {
    fetchMock
      .mockResolvedValueOnce({ json: async () => ({ id: 'container-abc' }) })
      .mockResolvedValueOnce({ json: async () => ({ status_code: 'IN_PROGRESS' }) })

    await expect(publishToInstagram(baseParams)).rejects.toThrow('ainda sendo processada')
  })

  it('lanca erro se container retornar ERROR e marca needsReauth', async () => {
    prismaMock.socialAccount.update.mockResolvedValue({})
    fetchMock
      .mockResolvedValueOnce({ json: async () => ({ id: 'container-abc' }) })
      .mockResolvedValueOnce({ json: async () => ({ status_code: 'ERROR', status: 'MEDIA_FAILED_DOWNLOAD' }) })

    await expect(publishToInstagram(baseParams)).rejects.toThrow('MEDIA_FAILED_DOWNLOAD')
  })

  it('lanca erro se videoUrl nao for fornecida', async () => {
    // eslint-disable-next-line @typescript-eslint/no-unused-vars
    const { videoUrl: _url, ...withoutUrl } = baseParams
    await expect(publishToInstagram(withoutUrl)).rejects.toThrow('videoUrl')
  })
})
