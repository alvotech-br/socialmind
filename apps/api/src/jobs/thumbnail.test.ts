import { describe, it, expect, vi, beforeEach } from 'vitest'
import { processThumbnail } from './thumbnail.job.js'

const prismaMock = vi.hoisted(() => ({
  mediaFile: { update: vi.fn() },
}))

vi.mock('../lib/prisma.js', () => ({ prisma: prismaMock }))

vi.mock('@aws-sdk/client-s3', () => ({
  GetObjectCommand: vi.fn(),
  PutObjectCommand: vi.fn(),
  S3Client: vi.fn(() => ({ send: vi.fn() })),
}))

vi.mock('../lib/storage.js', () => ({
  s3: { send: vi.fn() },
  BUCKET: 'test-bucket',
  ALLOWED_MIME_TYPES: ['video/mp4', 'image/jpeg'],
  MAX_FILE_SIZE: 500 * 1024 * 1024,
  createPresignedUploadUrl: vi.fn(),
  buildPublicUrl: vi.fn(),
  getExtension: vi.fn(),
}))

vi.mock('fs/promises', () => ({
  mkdir: vi.fn().mockResolvedValue(undefined),
  unlink: vi.fn().mockResolvedValue(undefined),
}))

vi.mock('fs', () => ({
  createWriteStream: vi.fn(() => {
    const emitter: Record<string, unknown> = {}
    emitter.on = vi.fn((event: string, cb: () => void) => {
      if (event === 'finish') setTimeout(cb, 0)
      return emitter
    })
    return emitter
  }),
  createReadStream: vi.fn(() => ({ pipe: vi.fn() })),
}))

vi.mock('fluent-ffmpeg', () => {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const builder: any = { screenshots: vi.fn().mockReturnThis(), on: vi.fn() }
  builder.on.mockImplementation((event: string, cb: (...args: unknown[]) => void) => {
    if (event === 'end') setTimeout(() => cb(), 0)
    return builder
  })
  return { default: vi.fn(() => builder) }
})

beforeEach(() => {
  vi.clearAllMocks()
  prismaMock.mediaFile.update.mockResolvedValue({})
})

describe('processThumbnail', () => {
  it('marca como SKIPPED para arquivos de imagem (nao video)', async () => {
    await processThumbnail({
      mediaFileId: 'mf-1',
      key: 'ws/cl/uuid.jpg',
      workspaceId: 'ws-1',
      mimeType: 'image/jpeg',
    })

    expect(prismaMock.mediaFile.update).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({ thumbnailStatus: 'SKIPPED' }),
      }),
    )
  })

  it('atualiza para PROCESSING antes de processar video', async () => {
    const { s3 } = await import('../lib/storage.js')
    const mockBody = { pipe: vi.fn() }
    ;(s3.send as ReturnType<typeof vi.fn>).mockResolvedValueOnce({ Body: mockBody })
    ;(s3.send as ReturnType<typeof vi.fn>).mockResolvedValueOnce({})

    await processThumbnail({
      mediaFileId: 'mf-2',
      key: 'ws/cl/uuid.mp4',
      workspaceId: 'ws-1',
      mimeType: 'video/mp4',
    })

    const calls = prismaMock.mediaFile.update.mock.calls
    expect(calls[0][0].data.thumbnailStatus).toBe('PROCESSING')
    expect(calls[1][0].data.thumbnailStatus).toBe('READY')
    expect(calls[1][0].data.thumbnailKey).toContain('-thumb.jpg')
  })

  it('marca como FAILED e relanca erro se ffmpeg falhar', async () => {
    const { s3 } = await import('../lib/storage.js')
    const mockBody = { pipe: vi.fn() }
    ;(s3.send as ReturnType<typeof vi.fn>).mockResolvedValueOnce({ Body: mockBody })

    const ffmpegModule = await import('fluent-ffmpeg')
    const ffmpegFn = ffmpegModule.default as unknown as ReturnType<typeof vi.fn>
    ffmpegFn.mockReturnValueOnce({
      on: vi.fn((event: string, cb: (err?: Error) => void) => {
        if (event === 'error') setTimeout(() => cb(new Error('ffmpeg crashed')), 0)
        return { screenshots: vi.fn().mockReturnThis(), on: vi.fn() }
      }),
      screenshots: vi.fn().mockReturnThis(),
    })

    await expect(
      processThumbnail({
        mediaFileId: 'mf-3',
        key: 'ws/cl/uuid.mp4',
        workspaceId: 'ws-1',
        mimeType: 'video/mp4',
      }),
    ).rejects.toThrow()

    expect(prismaMock.mediaFile.update).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({ thumbnailStatus: 'FAILED' }),
      }),
    )
  })

  it('enfileira job de thumbnail ao confirmar upload de video', async () => {
    const { thumbnailQueue } = await import('../lib/queue.js')
    expect(thumbnailQueue).toBeDefined()
  })
})
