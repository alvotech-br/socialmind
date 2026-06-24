import { describe, it, expect, vi, beforeEach } from 'vitest'

const mocks = vi.hoisted(() => ({
  generateAuthUrl: vi.fn().mockReturnValue('https://accounts.google.com/oauth?state=test'),
  getToken: vi.fn(),
  setCredentials: vi.fn(),
  on: vi.fn(),
  channelsList: vi.fn(),
  videosInsert: vi.fn(),
  s3Send: vi.fn().mockResolvedValue({
    Body: (async function* () { yield Buffer.from('video-data') })(),
  }),
}))

vi.mock('googleapis', () => ({
  google: {
    auth: {
      OAuth2: vi.fn().mockImplementation(() => ({
        generateAuthUrl: mocks.generateAuthUrl,
        getToken: mocks.getToken,
        setCredentials: mocks.setCredentials,
        on: mocks.on,
      })),
    },
    youtube: vi.fn().mockReturnValue({
      channels: { list: mocks.channelsList },
      videos: { insert: mocks.videosInsert },
    }),
  },
}))

vi.mock('fs', () => ({
  createReadStream: vi.fn().mockReturnValue({ pipe: vi.fn() }),
}))

vi.mock('fs/promises', () => ({
  unlink: vi.fn().mockResolvedValue(undefined),
  mkdir: vi.fn().mockResolvedValue(undefined),
  writeFile: vi.fn().mockResolvedValue(undefined),
}))

vi.mock('../storage.js', () => ({
  s3: { send: mocks.s3Send },
  BUCKET: 'test-bucket',
}))

vi.mock('../prisma.js', () => ({
  prisma: { socialAccount: { update: vi.fn() } },
}))

import { getYoutubeAuthUrl, exchangeYoutubeCode, publishToYoutube } from './youtube.js'

beforeEach(() => {
  vi.clearAllMocks()
  mocks.s3Send.mockResolvedValue({
    Body: (async function* () { yield Buffer.from('video-data') })(),
  })
})

describe('getYoutubeAuthUrl', () => {
  it('retorna URL de autorizacao do Google com o state correto', () => {
    const url = getYoutubeAuthUrl('ws:client:123')

    expect(mocks.generateAuthUrl).toHaveBeenCalledWith(
      expect.objectContaining({ state: 'ws:client:123', access_type: 'offline' }),
    )
    expect(url).toContain('accounts.google.com')
  })
})

describe('exchangeYoutubeCode', () => {
  it('troca code por tokens e retorna dados do canal', async () => {
    mocks.getToken.mockResolvedValueOnce({
      tokens: {
        access_token: 'acc-tok',
        refresh_token: 'ref-tok',
        expiry_date: Date.now() + 3600_000,
      },
    })
    mocks.channelsList.mockResolvedValueOnce({
      data: {
        items: [{ id: 'UC_channel_id', snippet: { customUrl: '@handle', title: 'My Channel' } }],
      },
    })

    const result = await exchangeYoutubeCode('auth-code')

    expect(result.accessToken).toBe('acc-tok')
    expect(result.refreshToken).toBe('ref-tok')
    expect(result.channelId).toBe('UC_channel_id')
    expect(result.handle).toBe('@handle')
    expect(result.expiresAt).toBeInstanceOf(Date)
  })

  it('lanca erro se canal nao for encontrado', async () => {
    mocks.getToken.mockResolvedValueOnce({
      tokens: { access_token: 'tok', refresh_token: 'ref', expiry_date: Date.now() },
    })
    mocks.channelsList.mockResolvedValueOnce({ data: { items: [] } })

    await expect(exchangeYoutubeCode('bad-code')).rejects.toThrow('Canal do YouTube nao encontrado')
  })
})

describe('publishToYoutube', () => {
  const baseParams = {
    caption: 'Titulo do video\nDescricao longa',
    accessToken: 'acc-tok',
    refreshToken: 'ref-tok',
    platformUserId: 'UC_channel_id',
    socialAccountId: 'aa000000-0000-0000-0000-000000000001',
  }

  it('publica video sem arquivo usando caption como titulo', async () => {
    mocks.videosInsert.mockResolvedValueOnce({ data: { id: 'yt-video-123' } })

    const result = await publishToYoutube(baseParams)

    expect(mocks.videosInsert).toHaveBeenCalledWith(
      expect.objectContaining({
        requestBody: expect.objectContaining({
          snippet: expect.objectContaining({ title: 'Titulo do video' }),
        }),
      }),
    )
    expect(result.platformPostId).toBe('yt-video-123')
    expect(result.publishedUrl).toContain('yt-video-123')
  })

  it('usa title explícito se fornecido', async () => {
    mocks.videosInsert.mockResolvedValueOnce({ data: { id: 'yt-video-456' } })

    await publishToYoutube({ ...baseParams, title: 'Titulo customizado' })

    expect(mocks.videosInsert).toHaveBeenCalledWith(
      expect.objectContaining({
        requestBody: expect.objectContaining({
          snippet: expect.objectContaining({ title: 'Titulo customizado' }),
        }),
      }),
    )
  })

  it('baixa video do S3 quando mediaKey e fornecido', async () => {
    mocks.videosInsert.mockResolvedValueOnce({ data: { id: 'yt-video-789' } })

    const result = await publishToYoutube({ ...baseParams, mediaKey: 'videos/test.mp4' })

    expect(mocks.s3Send).toHaveBeenCalled()
    expect(result.platformPostId).toBe('yt-video-789')
  })

  it('lanca erro se API do YouTube falhar', async () => {
    mocks.videosInsert.mockRejectedValueOnce(new Error('YouTube API error'))

    await expect(publishToYoutube(baseParams)).rejects.toThrow('YouTube API error')
  })
})
