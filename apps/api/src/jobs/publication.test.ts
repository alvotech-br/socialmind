import { describe, it, expect, vi, beforeEach } from 'vitest'
import { processPublication } from './publication.job.js'

const POST_UUID = 'bb000000-0000-0000-0000-000000000001'
const WS_UUID   = 'cc000000-0000-0000-0000-000000000001'

const prismaMock = vi.hoisted(() => ({
  post: {
    findUnique: vi.fn(),
    update: vi.fn(),
  },
  auditLog: { create: vi.fn() },
}))

vi.mock('../lib/prisma.js', () => ({ prisma: prismaMock }))
vi.mock('../lib/publishers/index.js', () => ({
  publish: vi.fn(),
  PlatformNotImplementedError: class PlatformNotImplementedError extends Error {
    constructor(platform: string) {
      super(`Publisher not implemented for platform: ${platform}`)
      this.name = 'PlatformNotImplementedError'
    }
  },
}))

const basePost = {
  id: POST_UUID,
  workspaceId: WS_UUID,
  caption: 'Teste',
  platform: 'YOUTUBE',
  status: 'SCHEDULED',
  mediaFileId: null,
  socialAccount: {
    clientId: 'client-1',
    accessToken: 'tok',
    refreshToken: null,
    platformUserId: 'yt-123',
  },
}

beforeEach(() => {
  vi.clearAllMocks()
  prismaMock.post.update.mockResolvedValue({})
  prismaMock.auditLog.create.mockResolvedValue({})
})

describe('processPublication', () => {
  it('atualiza status para PUBLISHED quando publicacao bem-sucedida', async () => {
    prismaMock.post.findUnique.mockResolvedValue(basePost)
    const { publish } = await import('../lib/publishers/index.js')
    ;(publish as ReturnType<typeof vi.fn>).mockResolvedValueOnce({ platformPostId: 'yt-post-abc' })

    await processPublication({ postId: POST_UUID, workspaceId: WS_UUID })

    const updateCalls = prismaMock.post.update.mock.calls
    expect(updateCalls[0][0].data.status).toBe('PROCESSING')
    expect(updateCalls[1][0].data.status).toBe('PUBLISHED')
    expect(updateCalls[1][0].data.publishedAt).toBeInstanceOf(Date)
  })

  it('atualiza para FAILED e NAO relanca para PlatformNotImplementedError', async () => {
    prismaMock.post.findUnique.mockResolvedValue(basePost)
    const { publish, PlatformNotImplementedError } = await import('../lib/publishers/index.js')
    ;(publish as ReturnType<typeof vi.fn>).mockRejectedValueOnce(
      new PlatformNotImplementedError('YOUTUBE'),
    )

    await expect(
      processPublication({ postId: POST_UUID, workspaceId: WS_UUID }),
    ).resolves.toBeUndefined()

    expect(prismaMock.post.update).toHaveBeenCalledWith(
      expect.objectContaining({ data: expect.objectContaining({ status: 'FAILED' }) }),
    )
  })

  it('relanca erro generico para que BullMQ faca retry', async () => {
    prismaMock.post.findUnique.mockResolvedValue(basePost)
    const { publish } = await import('../lib/publishers/index.js')
    ;(publish as ReturnType<typeof vi.fn>).mockRejectedValueOnce(new Error('network timeout'))

    await expect(
      processPublication({ postId: POST_UUID, workspaceId: WS_UUID }),
    ).rejects.toThrow('network timeout')

    expect(prismaMock.post.update).toHaveBeenCalledWith(
      expect.objectContaining({ data: expect.objectContaining({ status: 'FAILED' }) }),
    )
  })

  it('ignora post ja PUBLISHED (idempotente)', async () => {
    prismaMock.post.findUnique.mockResolvedValue({ ...basePost, status: 'PUBLISHED' })

    await processPublication({ postId: POST_UUID, workspaceId: WS_UUID })

    expect(prismaMock.post.update).not.toHaveBeenCalled()
  })
})
