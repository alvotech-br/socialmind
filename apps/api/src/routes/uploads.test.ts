import { describe, it, expect, vi, beforeEach } from 'vitest'
import { buildApp } from '../server.js'

const prismaMock = vi.hoisted(() => ({
  workspaceMember: { findFirst: vi.fn() },
  client: { findFirst: vi.fn() },
  mediaFile: {
    create: vi.fn(),
    findFirst: vi.fn(),
    update: vi.fn(),
  },
  auditLog: { create: vi.fn() },
  consentRecord: { create: vi.fn(), updateMany: vi.fn(), createMany: vi.fn() },
  refreshToken: { create: vi.fn(), findUnique: vi.fn(), updateMany: vi.fn() },
  passwordResetToken: { findUnique: vi.fn() },
  dataDeletionRequest: { findFirst: vi.fn() },
  workspace: { findUnique: vi.fn(), findUniqueOrThrow: vi.fn(), create: vi.fn(), update: vi.fn() },
  user: { findUnique: vi.fn(), findUniqueOrThrow: vi.fn() },
  workspaceMemberFindUnique: vi.fn(),
  $transaction: vi.fn(),
}))

vi.mock('../lib/prisma.js', () => ({ prisma: prismaMock }))
vi.mock('../lib/storage.js', () => ({
  createPresignedUploadUrl: vi.fn().mockResolvedValue('https://minio.local/bucket/key?sig=abc'),
  buildPublicUrl: vi.fn((key: string) => `http://localhost:9000/socialplatform-local/${key}`),
  getExtension: vi.fn().mockReturnValue('mp4'),
  ALLOWED_MIME_TYPES: ['video/mp4', 'video/quicktime', 'video/webm', 'image/jpeg', 'image/png', 'image/webp'],
  MAX_FILE_SIZE: 500 * 1024 * 1024,
}))

const CLIENT_UUID   = '10000000-0000-0000-0000-000000000001'
const CLIENT_UUID_2 = '10000000-0000-0000-0000-000000000002'
const MEDIA_UUID    = '20000000-0000-0000-0000-000000000001'
const WS_UUID       = 'ae7a11ff-603a-49bc-9928-08731820c001'

const ownerMember = { role: 'OWNER', workspace: { accountType: 'AGENCY', deletedAt: null } }
const selfMember  = { role: 'OWNER', workspace: { accountType: 'SELF',   deletedAt: null } }

beforeEach(() => {
  vi.clearAllMocks()
  prismaMock.auditLog.create.mockResolvedValue({})
})

describe('POST /uploads/presigned-url', () => {
  it('gera URL pre-assinada e cria MediaFile PENDING para workspace AGENCY', async () => {
    prismaMock.workspaceMember.findFirst.mockResolvedValue(ownerMember)
    prismaMock.client.findFirst.mockResolvedValue({ id: CLIENT_UUID, workspaceId: WS_UUID })
    prismaMock.mediaFile.create.mockResolvedValue({ id: MEDIA_UUID })

    const app = await buildApp()
    const token = app.jwt.sign({ id: 'user-1' })

    const res = await app.inject({
      method: 'POST',
      url: '/uploads/presigned-url',
      headers: { authorization: `Bearer ${token}`, 'x-workspace-id': WS_UUID },
      payload: { filename: 'video.mp4', mimeType: 'video/mp4', size: 1024 * 1024, clientId: CLIENT_UUID },
    })

    expect(res.statusCode).toBe(201)
    expect(res.json()).toMatchObject({
      uploadUrl: expect.stringContaining('https://'),
      mediaFileId: MEDIA_UUID,
      expiresIn: 900,
    })
  })

  it('retorna 400 para MIME type nao permitido', async () => {
    prismaMock.workspaceMember.findFirst.mockResolvedValue(ownerMember)
    prismaMock.client.findFirst.mockResolvedValue({ id: CLIENT_UUID, workspaceId: WS_UUID })

    const app = await buildApp()
    const token = app.jwt.sign({ id: 'user-1' })

    const res = await app.inject({
      method: 'POST',
      url: '/uploads/presigned-url',
      headers: { authorization: `Bearer ${token}`, 'x-workspace-id': WS_UUID },
      payload: { filename: 'virus.exe', mimeType: 'application/x-msdownload', size: 1024, clientId: CLIENT_UUID },
    })

    expect(res.statusCode).toBe(400)
  })

  it('retorna 404 quando clientId nao pertence ao workspace', async () => {
    prismaMock.workspaceMember.findFirst.mockResolvedValue(ownerMember)
    prismaMock.client.findFirst.mockResolvedValue(null)

    const app = await buildApp()
    const token = app.jwt.sign({ id: 'user-1' })

    const res = await app.inject({
      method: 'POST',
      url: '/uploads/presigned-url',
      headers: { authorization: `Bearer ${token}`, 'x-workspace-id': WS_UUID },
      payload: { filename: 'video.mp4', mimeType: 'video/mp4', size: 1024, clientId: CLIENT_UUID_2 },
    })

    expect(res.statusCode).toBe(404)
  })

  it('workspace SELF injeta clientId automaticamente sem precisar do body', async () => {
    prismaMock.workspaceMember.findFirst.mockResolvedValue(selfMember)
    prismaMock.client.findFirst
      .mockResolvedValueOnce({ id: CLIENT_UUID, isSelf: true }) // workspace-context
      .mockResolvedValueOnce({ id: CLIENT_UUID, workspaceId: WS_UUID }) // uploads route
    prismaMock.mediaFile.create.mockResolvedValue({ id: MEDIA_UUID })

    const app = await buildApp()
    const token = app.jwt.sign({ id: 'user-1' })

    const res = await app.inject({
      method: 'POST',
      url: '/uploads/presigned-url',
      headers: { authorization: `Bearer ${token}`, 'x-workspace-id': WS_UUID },
      payload: { filename: 'foto.jpg', mimeType: 'image/jpeg', size: 512 * 1024 },
    })

    expect(res.statusCode).toBe(201)
  })
})

describe('POST /uploads/confirm', () => {
  it('confirma upload e muda status para READY', async () => {
    prismaMock.workspaceMember.findFirst.mockResolvedValue(ownerMember)
    prismaMock.client.findFirst.mockResolvedValue(null)
    prismaMock.mediaFile.findFirst.mockResolvedValue({
      id: MEDIA_UUID, workspaceId: WS_UUID, status: 'PENDING', key: `${WS_UUID}/${CLIENT_UUID}/uuid.mp4`, mimeType: 'video/mp4', size: 1024,
    })
    prismaMock.mediaFile.update.mockResolvedValue({
      id: MEDIA_UUID, key: `${WS_UUID}/${CLIENT_UUID}/uuid.mp4`, mimeType: 'video/mp4', size: 1024, status: 'READY',
    })

    const app = await buildApp()
    const token = app.jwt.sign({ id: 'user-1' })

    const res = await app.inject({
      method: 'POST',
      url: '/uploads/confirm',
      headers: { authorization: `Bearer ${token}`, 'x-workspace-id': WS_UUID },
      payload: { mediaFileId: MEDIA_UUID },
    })

    expect(res.statusCode).toBe(200)
    expect(res.json().status).toBe('READY')
  })

  it('retorna 409 ao confirmar arquivo ja confirmado', async () => {
    prismaMock.workspaceMember.findFirst.mockResolvedValue(ownerMember)
    prismaMock.client.findFirst.mockResolvedValue(null)
    prismaMock.mediaFile.findFirst.mockResolvedValue({
      id: MEDIA_UUID, workspaceId: WS_UUID, status: 'READY', key: `${WS_UUID}/${CLIENT_UUID}/uuid.mp4`,
    })

    const app = await buildApp()
    const token = app.jwt.sign({ id: 'user-1' })

    const res = await app.inject({
      method: 'POST',
      url: '/uploads/confirm',
      headers: { authorization: `Bearer ${token}`, 'x-workspace-id': WS_UUID },
      payload: { mediaFileId: MEDIA_UUID },
    })

    expect(res.statusCode).toBe(409)
  })

  it('retorna 404 para mediaFileId de outro workspace', async () => {
    prismaMock.workspaceMember.findFirst.mockResolvedValue(ownerMember)
    prismaMock.client.findFirst.mockResolvedValue(null)
    prismaMock.mediaFile.findFirst.mockResolvedValue(null)

    const app = await buildApp()
    const token = app.jwt.sign({ id: 'user-1' })

    const res = await app.inject({
      method: 'POST',
      url: '/uploads/confirm',
      headers: { authorization: `Bearer ${token}`, 'x-workspace-id': WS_UUID },
      payload: { mediaFileId: '99999999-9999-9999-9999-999999999999' },
    })

    expect(res.statusCode).toBe(404)
  })
})
