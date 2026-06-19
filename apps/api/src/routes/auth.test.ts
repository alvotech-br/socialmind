import { describe, it, expect, vi, beforeEach } from 'vitest'
import bcrypt from 'bcryptjs'
import { buildApp } from '../server.js'

const prismaMock = vi.hoisted(() => ({
  user: {
    findUnique: vi.fn(),
    findUniqueOrThrow: vi.fn(),
    create: vi.fn(),
    update: vi.fn(),
  },
  workspace: {
    create: vi.fn(),
    findUniqueOrThrow: vi.fn(),
  },
  workspaceMember: {
    create: vi.fn(),
  },
  client: {
    create: vi.fn(),
  },
  consentRecord: {
    createMany: vi.fn(),
    updateMany: vi.fn(),
  },
  auditLog: {
    create: vi.fn(),
  },
  refreshToken: {
    create: vi.fn(),
    findUnique: vi.fn(),
    update: vi.fn(),
    updateMany: vi.fn(),
  },
  passwordResetToken: {
    create: vi.fn(),
    findUnique: vi.fn(),
    update: vi.fn(),
  },
  $transaction: vi.fn((ops: unknown[]) => Promise.all(ops)),
}))

vi.mock('../lib/prisma.js', () => ({ prisma: prismaMock }))

const mockUser = {
  id: 'user-id-1',
  email: 'test@example.com',
  passwordHash: '',
  name: 'Test User',
  locale: 'pt-BR',
  twoFaEnabled: false,
  twoFaSecret: null,
  twoFaBackupCodes: [],
  deletedAt: null,
}

const mockWorkspace = {
  id: 'workspace-id-1',
  ownerId: mockUser.id,
  name: mockUser.name,
  slug: 'test-user-123',
  accountType: 'SELF',
  selfOwned: true,
  planType: 'TRIAL',
  trialEndsAt: new Date(Date.now() + 14 * 24 * 60 * 60 * 1000),
}

const mockRefreshToken = {
  id: 'rt-id-1',
  userId: mockUser.id,
  tokenHash: '',
  expiresAt: new Date(Date.now() + 7 * 24 * 60 * 60 * 1000),
  revokedAt: null,
}

const mockResetToken = {
  id: 'prt-id-1',
  userId: mockUser.id,
  tokenHash: '',
  expiresAt: new Date(Date.now() + 60 * 60 * 1000),
  usedAt: null,
}

beforeEach(async () => {
  vi.clearAllMocks()
  mockUser.passwordHash = await bcrypt.hash('Senha123', 12)
  prismaMock.user.create.mockResolvedValue(mockUser)
  prismaMock.user.findUnique.mockResolvedValue(null)
  prismaMock.user.findUniqueOrThrow.mockResolvedValue(mockUser)
  prismaMock.user.update.mockResolvedValue(mockUser)
  prismaMock.workspace.create.mockResolvedValue(mockWorkspace)
  prismaMock.workspace.findUniqueOrThrow.mockResolvedValue(mockWorkspace)
  prismaMock.workspaceMember.create.mockResolvedValue({})
  prismaMock.client.create.mockResolvedValue({})
  prismaMock.consentRecord.createMany.mockResolvedValue({ count: 2 })
  prismaMock.consentRecord.updateMany.mockResolvedValue({ count: 0 })
  prismaMock.auditLog.create.mockResolvedValue({})
  prismaMock.refreshToken.create.mockResolvedValue(mockRefreshToken)
  prismaMock.refreshToken.update.mockResolvedValue({ ...mockRefreshToken, revokedAt: new Date() })
  prismaMock.refreshToken.updateMany.mockResolvedValue({ count: 1 })
  prismaMock.passwordResetToken.create.mockResolvedValue(mockResetToken)
  prismaMock.passwordResetToken.update.mockResolvedValue({ ...mockResetToken, usedAt: new Date() })
})

// ── REGISTER STEP 1 ──────────────────────────────────────────────────────────

describe('POST /auth/register/step1', () => {
  it('cria usuario e retorna sessionToken', async () => {
    const app = await buildApp()
    const res = await app.inject({
      method: 'POST',
      url: '/auth/register/step1',
      payload: {
        name: 'Test User',
        email: 'new@example.com',
        password: 'Senha123',
        acceptedTerms: true,
        acceptedPrivacy: true,
      },
    })
    expect(res.statusCode).toBe(201)
    expect(res.json().sessionToken).toBeTruthy()
  })

  it('bloqueia quando LGPD nao aceito', async () => {
    const app = await buildApp()
    const res = await app.inject({
      method: 'POST',
      url: '/auth/register/step1',
      payload: {
        name: 'Test User',
        email: 'new@example.com',
        password: 'Senha123',
        acceptedTerms: false,
        acceptedPrivacy: true,
      },
    })
    expect(res.statusCode).toBe(400)
    expect(res.json().error).toBe('LGPD_CONSENT_REQUIRED')
  })

  it('retorna 409 se email ja existe', async () => {
    prismaMock.user.findUnique.mockResolvedValue(mockUser)
    const app = await buildApp()
    const res = await app.inject({
      method: 'POST',
      url: '/auth/register/step1',
      payload: {
        name: 'Test User',
        email: 'test@example.com',
        password: 'Senha123',
        acceptedTerms: true,
        acceptedPrivacy: true,
      },
    })
    expect(res.statusCode).toBe(409)
    expect(res.json().error).toBe('EMAIL_EXISTS')
  })

  it('retorna 400 para senha fraca', async () => {
    const app = await buildApp()
    const res = await app.inject({
      method: 'POST',
      url: '/auth/register/step1',
      payload: {
        name: 'Test User',
        email: 'new@example.com',
        password: 'fraca',
        acceptedTerms: true,
        acceptedPrivacy: true,
      },
    })
    expect(res.statusCode).toBe(400)
    expect(res.json().error).toBe('WEAK_PASSWORD')
  })

  it('vincula cookieSessionId ao usuario criado', async () => {
    const app = await buildApp()
    await app.inject({
      method: 'POST',
      url: '/auth/register/step1',
      payload: {
        name: 'Test User',
        email: 'new@example.com',
        password: 'Senha123',
        acceptedTerms: true,
        acceptedPrivacy: true,
        cookieSessionId: 'session-xyz',
      },
    })
    expect(prismaMock.consentRecord.updateMany).toHaveBeenCalledWith(
      expect.objectContaining({ where: expect.objectContaining({ sessionId: 'session-xyz' }) })
    )
  })
})

// ── REGISTER STEP 2 ──────────────────────────────────────────────────────────

describe('POST /auth/register/step2', () => {
  it('cria workspace e retorna sessionToken', async () => {
    const app = await buildApp()
    const token = app.jwt.sign({ id: mockUser.id, step: 1 })
    const res = await app.inject({
      method: 'POST',
      url: '/auth/register/step2',
      headers: { authorization: `Bearer ${token}` },
      payload: { accountType: 'SELF' },
    })
    expect(res.statusCode).toBe(200)
    expect(res.json().sessionToken).toBeTruthy()
    expect(prismaMock.client.create).toHaveBeenCalled()
  })

  it('nao cria client quando accountType AGENCY', async () => {
    const app = await buildApp()
    const token = app.jwt.sign({ id: mockUser.id, step: 1 })
    await app.inject({
      method: 'POST',
      url: '/auth/register/step2',
      headers: { authorization: `Bearer ${token}` },
      payload: { accountType: 'AGENCY' },
    })
    expect(prismaMock.client.create).not.toHaveBeenCalled()
  })

  it('retorna 401 sem token', async () => {
    const app = await buildApp()
    const res = await app.inject({
      method: 'POST',
      url: '/auth/register/step2',
      payload: { accountType: 'SELF' },
    })
    expect(res.statusCode).toBe(401)
  })
})

// ── REGISTER STEP 3 ──────────────────────────────────────────────────────────

describe('POST /auth/register/step3', () => {
  it('retorna accessToken e cria AuditLog', async () => {
    const app = await buildApp()
    const token = app.jwt.sign({ id: mockUser.id, workspaceId: mockWorkspace.id, step: 2 })
    const res = await app.inject({
      method: 'POST',
      url: '/auth/register/step3',
      headers: { authorization: `Bearer ${token}` },
    })
    expect(res.statusCode).toBe(200)
    const body = res.json()
    expect(body.accessToken).toBeTruthy()
    expect(body.user.email).toBe(mockUser.email)
    expect(prismaMock.auditLog.create).toHaveBeenCalledWith(
      expect.objectContaining({ data: expect.objectContaining({ action: 'user.registered' }) })
    )
  })
})

// ── LOGIN ────────────────────────────────────────────────────────────────────

describe('POST /auth/login', () => {
  it('retorna accessToken para credenciais validas', async () => {
    prismaMock.user.findUnique.mockResolvedValue({ ...mockUser })
    const app = await buildApp()
    const res = await app.inject({
      method: 'POST',
      url: '/auth/login',
      payload: { email: mockUser.email, password: 'Senha123' },
    })
    expect(res.statusCode).toBe(200)
    expect(res.json().accessToken).toBeTruthy()
  })

  it('retorna 401 para senha errada', async () => {
    prismaMock.user.findUnique.mockResolvedValue({ ...mockUser })
    const app = await buildApp()
    const res = await app.inject({
      method: 'POST',
      url: '/auth/login',
      payload: { email: mockUser.email, password: 'SenhaErrada1' },
    })
    expect(res.statusCode).toBe(401)
  })

  it('retorna 401 para usuario inexistente (anti-enumeration)', async () => {
    prismaMock.user.findUnique.mockResolvedValue(null)
    const app = await buildApp()
    const res = await app.inject({
      method: 'POST',
      url: '/auth/login',
      payload: { email: 'naoexiste@example.com', password: 'Senha123' },
    })
    expect(res.statusCode).toBe(401)
    expect(res.json().error).toBe('INVALID_CREDENTIALS')
  })

  it('retorna requires2FA quando 2FA habilitado', async () => {
    prismaMock.user.findUnique.mockResolvedValue({ ...mockUser, twoFaEnabled: true, twoFaSecret: 'SECRET' })
    const app = await buildApp()
    const res = await app.inject({
      method: 'POST',
      url: '/auth/login',
      payload: { email: mockUser.email, password: 'Senha123' },
    })
    expect(res.statusCode).toBe(200)
    expect(res.json().requires2FA).toBe(true)
    expect(res.json().tempToken).toBeTruthy()
  })
})

// ── REFRESH TOKEN ────────────────────────────────────────────────────────────

describe('POST /auth/refresh', () => {
  it('retorna 401 sem cookie refreshToken', async () => {
    const app = await buildApp()
    const res = await app.inject({ method: 'POST', url: '/auth/refresh' })
    expect(res.statusCode).toBe(401)
  })

  it('retorna 401 com token revogado', async () => {
    prismaMock.refreshToken.findUnique.mockResolvedValue({ ...mockRefreshToken, revokedAt: new Date() })
    const app = await buildApp()
    const res = await app.inject({
      method: 'POST',
      url: '/auth/refresh',
      cookies: { refreshToken: 'some-raw-token' },
    })
    expect(res.statusCode).toBe(401)
  })
})

// ── LOGOUT ───────────────────────────────────────────────────────────────────

describe('POST /auth/logout', () => {
  it('revoga token e retorna ok', async () => {
    const app = await buildApp()
    const token = app.jwt.sign({ id: mockUser.id })
    const res = await app.inject({
      method: 'POST',
      url: '/auth/logout',
      headers: { authorization: `Bearer ${token}` },
      cookies: { refreshToken: 'some-raw-token' },
    })
    expect(res.statusCode).toBe(200)
    expect(res.json().ok).toBe(true)
  })

  it('retorna 401 sem autenticacao', async () => {
    const app = await buildApp()
    const res = await app.inject({ method: 'POST', url: '/auth/logout' })
    expect(res.statusCode).toBe(401)
  })
})

// ── FORGOT PASSWORD ──────────────────────────────────────────────────────────

describe('POST /auth/forgot-password', () => {
  it('retorna ok:true mesmo para email inexistente (anti-enumeration)', async () => {
    prismaMock.user.findUnique.mockResolvedValue(null)
    const app = await buildApp()
    const res = await app.inject({
      method: 'POST',
      url: '/auth/forgot-password',
      payload: { email: 'naoexiste@example.com' },
    })
    expect(res.statusCode).toBe(200)
    expect(res.json().ok).toBe(true)
    expect(prismaMock.passwordResetToken.create).not.toHaveBeenCalled()
  })

  it('retorna ok:true e cria token para email existente', async () => {
    prismaMock.user.findUnique.mockResolvedValue(mockUser)
    const app = await buildApp()
    const res = await app.inject({
      method: 'POST',
      url: '/auth/forgot-password',
      payload: { email: mockUser.email },
    })
    expect(res.statusCode).toBe(200)
    expect(res.json().ok).toBe(true)
    expect(prismaMock.passwordResetToken.create).toHaveBeenCalled()
  })
})

// ── RESET PASSWORD ───────────────────────────────────────────────────────────

describe('POST /auth/reset-password', () => {
  it('reseta a senha com token valido', async () => {
    const { hashToken } = await import('../lib/tokens.js')
    const rawToken = 'a'.repeat(64)
    const tokenHash = hashToken(rawToken)
    prismaMock.passwordResetToken.findUnique.mockResolvedValue({ ...mockResetToken, tokenHash })
    prismaMock.$transaction.mockResolvedValue([{}, {}, {}])

    const app = await buildApp()
    const res = await app.inject({
      method: 'POST',
      url: '/auth/reset-password',
      payload: { token: rawToken, password: 'NovaSenha123' },
    })
    expect(res.statusCode).toBe(200)
    expect(res.json().ok).toBe(true)
  })

  it('retorna 400 para token invalido', async () => {
    prismaMock.passwordResetToken.findUnique.mockResolvedValue(null)
    const app = await buildApp()
    const res = await app.inject({
      method: 'POST',
      url: '/auth/reset-password',
      payload: { token: 'invalid-token', password: 'NovaSenha123' },
    })
    expect(res.statusCode).toBe(400)
    expect(res.json().error).toBe('TOKEN_INVALID')
  })

  it('retorna 400 para senha fraca', async () => {
    const app = await buildApp()
    const res = await app.inject({
      method: 'POST',
      url: '/auth/reset-password',
      payload: { token: 'some-token', password: 'fraca' },
    })
    expect(res.statusCode).toBe(400)
    expect(res.json().error).toBe('WEAK_PASSWORD')
  })
})
