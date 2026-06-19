import type { FastifyPluginAsync } from 'fastify'
import { z } from 'zod'
import bcrypt from 'bcryptjs'
import { authenticator } from 'otplib'
import QRCode from 'qrcode'
import crypto from 'crypto'
import { prisma } from '../lib/prisma.js'
import { generateSecureToken, hashToken } from '../lib/tokens.js'

const BCRYPT_ROUNDS = 12
const JWT_EXPIRY = '15m'
const REFRESH_EXPIRY_DAYS = 7
const RESET_EXPIRY_HOURS = 1
const SESSION_EXPIRY_MINUTES = 30

const passwordSchema = z.string().min(8).regex(/[A-Z]/).regex(/[0-9]/)
const emailSchema = z.string().email()

export const authRoutes: FastifyPluginAsync = async (fastify) => {

  // ── REGISTRO STEP 1 ────────────────────────────────────────────────────────

  fastify.post('/register/step1', async (request, reply) => {
    const schema = z.object({
      name: z.string().min(1),
      email: emailSchema,
      password: passwordSchema,
      acceptedTerms: z.boolean(),
      acceptedPrivacy: z.boolean(),
      cookieSessionId: z.string().optional(),
      locale: z.enum(['pt-BR', 'es', 'en']).optional(),
    })

    const parsed = schema.safeParse(request.body)
    if (!parsed.success) {
      const issue = parsed.error.errors[0]
      if (issue?.path.includes('email')) {
        return reply.status(400).send({ error: 'INVALID_EMAIL', message: request.t('errors.invalidEmail') })
      }
      if (issue?.path.includes('password')) {
        return reply.status(400).send({ error: 'WEAK_PASSWORD', message: request.t('errors.weakPassword') })
      }
      return reply.status(400).send({ error: 'INVALID_INPUT', message: issue?.message })
    }

    const { name, email, password, acceptedTerms, acceptedPrivacy, cookieSessionId, locale } = parsed.data

    if (!acceptedTerms || !acceptedPrivacy) {
      return reply.status(400).send({
        error: 'LGPD_CONSENT_REQUIRED',
        message: request.t('errors.lgpdConsentRequired'),
      })
    }

    const existing = await prisma.user.findUnique({ where: { email } })
    if (existing) {
      return reply.status(409).send({ error: 'EMAIL_EXISTS', message: request.t('errors.emailAlreadyExists') })
    }

    const userLocale = locale ?? (request.locale as 'pt-BR' | 'es' | 'en') ?? 'pt-BR'
    const passwordHash = await bcrypt.hash(password, BCRYPT_ROUNDS)

    const user = await prisma.user.create({
      data: { email, passwordHash, name, locale: userLocale },
    })

    await prisma.consentRecord.createMany({
      data: [
        { userId: user.id, consentType: 'TERMS', version: 'v1.0', ip: request.ip, locale: userLocale },
        { userId: user.id, consentType: 'PRIVACY', version: 'v1.0', ip: request.ip, locale: userLocale },
      ],
    })

    if (cookieSessionId) {
      await prisma.consentRecord.updateMany({
        where: { sessionId: cookieSessionId, consentType: 'COOKIES', userId: null },
        data: { userId: user.id },
      })
    }

    const sessionToken = fastify.jwt.sign(
      { id: user.id, step: 1 },
      { expiresIn: `${SESSION_EXPIRY_MINUTES}m` }
    )

    return reply.status(201).send({ sessionToken })
  })

  // ── REGISTRO STEP 2 ────────────────────────────────────────────────────────

  fastify.post('/register/step2', {
    onRequest: [fastify.authenticate],
  }, async (request, reply) => {
    const schema = z.object({ accountType: z.enum(['AGENCY', 'SELF']) })
    const parsed = schema.safeParse(request.body)
    if (!parsed.success) {
      return reply.status(400).send({ error: 'INVALID_INPUT', message: parsed.error.errors[0]?.message })
    }

    const user = request.user as { id: string }
    const { accountType } = parsed.data

    const dbUser = await prisma.user.findUniqueOrThrow({ where: { id: user.id } })
    const slug = `${dbUser.name.toLowerCase().replace(/\s+/g, '-')}-${Date.now()}`

    const workspace = await prisma.workspace.create({
      data: {
        ownerId: dbUser.id,
        name: dbUser.name,
        slug,
        accountType,
        selfOwned: accountType === 'SELF',
        planType: 'TRIAL',
        trialEndsAt: new Date(Date.now() + 14 * 24 * 60 * 60 * 1000),
      },
    })

    await prisma.workspaceMember.create({
      data: { workspaceId: workspace.id, userId: dbUser.id, role: 'OWNER' },
    })

    if (accountType === 'SELF') {
      await prisma.client.create({
        data: { workspaceId: workspace.id, name: dbUser.name, isSelf: true },
      })
    }

    const sessionToken = fastify.jwt.sign(
      { id: dbUser.id, workspaceId: workspace.id, step: 2 },
      { expiresIn: `${SESSION_EXPIRY_MINUTES}m` }
    )

    return reply.send({ sessionToken })
  })

  // ── REGISTRO STEP 3 ────────────────────────────────────────────────────────

  fastify.post('/register/step3', {
    onRequest: [fastify.authenticate],
  }, async (request, reply) => {
    const payload = request.user as { id: string; workspaceId: string }

    const dbUser = await prisma.user.findUniqueOrThrow({ where: { id: payload.id } })
    const workspace = await prisma.workspace.findUniqueOrThrow({ where: { id: payload.workspaceId } })

    await prisma.auditLog.create({
      data: {
        userId: dbUser.id,
        workspaceId: workspace.id,
        action: 'user.registered',
        metadata: { accountType: workspace.accountType, locale: dbUser.locale },
        ipAddress: request.ip,
        userAgent: request.headers['user-agent'] ?? null,
      },
    })

    const { accessToken, refreshTokenRaw } = await issueTokens(fastify, dbUser.id)

    const trialEndsAt = workspace.trialEndsAt!
    const daysLeft = Math.ceil((trialEndsAt.getTime() - Date.now()) / (1000 * 60 * 60 * 24))

    reply.setCookie('refreshToken', refreshTokenRaw, {
      httpOnly: true,
      secure: process.env.NODE_ENV === 'production',
      sameSite: 'strict',
      path: '/auth/refresh',
      maxAge: REFRESH_EXPIRY_DAYS * 24 * 60 * 60,
    })

    return reply.send({
      user: { id: dbUser.id, name: dbUser.name, email: dbUser.email, locale: dbUser.locale },
      workspace: { id: workspace.id, slug: workspace.slug, accountType: workspace.accountType },
      trial: { endsAt: trialEndsAt, daysLeft },
      accessToken,
    })
  })

  // ── LOGIN ──────────────────────────────────────────────────────────────────

  fastify.post('/login', async (request, reply) => {
    const schema = z.object({
      email: emailSchema,
      password: z.string().min(1),
    })

    const parsed = schema.safeParse(request.body)
    if (!parsed.success) {
      return reply.status(401).send({ error: 'INVALID_CREDENTIALS', message: request.t('errors.invalidCredentials') })
    }

    const { email, password } = parsed.data
    const user = await prisma.user.findUnique({ where: { email, deletedAt: null } })
    const validPassword = user ? await bcrypt.compare(password, user.passwordHash) : false

    if (!user || !validPassword) {
      return reply.status(401).send({ error: 'INVALID_CREDENTIALS', message: request.t('errors.invalidCredentials') })
    }

    await prisma.auditLog.create({
      data: { userId: user.id, action: 'user.login', ipAddress: request.ip, userAgent: request.headers['user-agent'] ?? null },
    })

    if (user.twoFaEnabled) {
      const tempToken = fastify.jwt.sign({ id: user.id, twoFaPending: true }, { expiresIn: '5m' })
      return reply.send({ requires2FA: true, tempToken })
    }

    const { accessToken, refreshTokenRaw } = await issueTokens(fastify, user.id)

    reply.setCookie('refreshToken', refreshTokenRaw, {
      httpOnly: true,
      secure: process.env.NODE_ENV === 'production',
      sameSite: 'strict',
      path: '/auth/refresh',
      maxAge: REFRESH_EXPIRY_DAYS * 24 * 60 * 60,
    })

    return reply.send({ accessToken })
  })

  // ── 2FA CHALLENGE ──────────────────────────────────────────────────────────

  fastify.post('/2fa/challenge', async (request, reply) => {
    const schema = z.object({ code: z.string().min(6), tempToken: z.string() })
    const parsed = schema.safeParse(request.body)
    if (!parsed.success) {
      return reply.status(400).send({ error: 'INVALID_INPUT', message: parsed.error.errors[0]?.message })
    }

    let payload: { id: string; twoFaPending: boolean }
    try {
      payload = fastify.jwt.verify(parsed.data.tempToken) as typeof payload
    } catch {
      return reply.status(401).send({ error: 'UNAUTHORIZED', message: request.t('errors.unauthorized') })
    }

    if (!payload.twoFaPending) {
      return reply.status(401).send({ error: 'UNAUTHORIZED', message: request.t('errors.unauthorized') })
    }

    const user = await prisma.user.findUniqueOrThrow({ where: { id: payload.id } })
    const { code } = parsed.data

    const isValid = user.twoFaSecret
      ? authenticator.verify({ token: code, secret: user.twoFaSecret })
      : false

    const backupIndex = user.twoFaBackupCodes.findIndex((c) => c === code && !c.startsWith('used:'))
    const usedBackup = !isValid && backupIndex >= 0

    if (!isValid && !usedBackup) {
      return reply.status(401).send({ error: 'INVALID_2FA', message: request.t('errors.invalidCredentials') })
    }

    if (usedBackup) {
      const codes = [...user.twoFaBackupCodes]
      codes[backupIndex] = `used:${codes[backupIndex]}`
      await prisma.user.update({ where: { id: user.id }, data: { twoFaBackupCodes: codes } })
    }

    await prisma.auditLog.create({
      data: { userId: user.id, action: 'user.2faVerified', ipAddress: request.ip, userAgent: request.headers['user-agent'] ?? null },
    })

    const { accessToken, refreshTokenRaw } = await issueTokens(fastify, user.id)

    reply.setCookie('refreshToken', refreshTokenRaw, {
      httpOnly: true,
      secure: process.env.NODE_ENV === 'production',
      sameSite: 'strict',
      path: '/auth/refresh',
      maxAge: REFRESH_EXPIRY_DAYS * 24 * 60 * 60,
    })

    return reply.send({ accessToken })
  })

  // ── REFRESH TOKEN ──────────────────────────────────────────────────────────

  fastify.post('/refresh', async (request, reply) => {
    const raw = request.cookies['refreshToken']
    if (!raw) {
      return reply.status(401).send({ error: 'UNAUTHORIZED', message: request.t('errors.unauthorized') })
    }

    const tokenHash = hashToken(raw)
    const stored = await prisma.refreshToken.findUnique({ where: { tokenHash } })

    if (!stored || stored.revokedAt || stored.expiresAt < new Date()) {
      return reply.status(401).send({ error: 'UNAUTHORIZED', message: request.t('errors.unauthorized') })
    }

    await prisma.refreshToken.update({ where: { id: stored.id }, data: { revokedAt: new Date() } })

    const { accessToken, refreshTokenRaw } = await issueTokens(fastify, stored.userId)

    reply.setCookie('refreshToken', refreshTokenRaw, {
      httpOnly: true,
      secure: process.env.NODE_ENV === 'production',
      sameSite: 'strict',
      path: '/auth/refresh',
      maxAge: REFRESH_EXPIRY_DAYS * 24 * 60 * 60,
    })

    return reply.send({ accessToken })
  })

  // ── LOGOUT ─────────────────────────────────────────────────────────────────

  fastify.post('/logout', { onRequest: [fastify.authenticate] }, async (request, reply) => {
    const raw = request.cookies['refreshToken']
    if (raw) {
      const tokenHash = hashToken(raw)
      await prisma.refreshToken.updateMany({
        where: { tokenHash, revokedAt: null },
        data: { revokedAt: new Date() },
      })
    }
    reply.clearCookie('refreshToken', { path: '/auth/refresh' })
    return reply.send({ ok: true })
  })

  // ── FORGOT PASSWORD ────────────────────────────────────────────────────────

  fastify.post('/forgot-password', async (request, reply) => {
    const schema = z.object({ email: emailSchema })
    const parsed = schema.safeParse(request.body)
    if (!parsed.success) {
      return reply.send({ ok: true })
    }

    const user = await prisma.user.findUnique({ where: { email: parsed.data.email, deletedAt: null } })

    if (user) {
      const token = generateSecureToken()
      const tokenHash = hashToken(token)

      await prisma.passwordResetToken.create({
        data: {
          userId: user.id,
          tokenHash,
          expiresAt: new Date(Date.now() + RESET_EXPIRY_HOURS * 60 * 60 * 1000),
        },
      })

      await prisma.auditLog.create({
        data: { userId: user.id, action: 'user.passwordResetRequested', ipAddress: request.ip },
      })

      const resetUrl = `${process.env.APP_URL}/reset-password?token=${token}`
      fastify.log.info({ resetUrl }, 'Password reset link (dev only)')
    }

    return reply.send({ ok: true })
  })

  // ── RESET PASSWORD ─────────────────────────────────────────────────────────

  fastify.post('/reset-password', async (request, reply) => {
    const schema = z.object({ token: z.string().min(1), password: passwordSchema })
    const parsed = schema.safeParse(request.body)
    if (!parsed.success) {
      const issue = parsed.error.errors[0]
      if (issue?.path.includes('password')) {
        return reply.status(400).send({ error: 'WEAK_PASSWORD', message: request.t('errors.weakPassword') })
      }
      return reply.status(400).send({ error: 'INVALID_INPUT', message: issue?.message })
    }

    const { token, password } = parsed.data
    const tokenHash = hashToken(token)
    const record = await prisma.passwordResetToken.findUnique({ where: { tokenHash } })

    if (!record || record.usedAt) {
      return reply.status(400).send({ error: 'TOKEN_INVALID', message: request.t('errors.tokenInvalid') })
    }

    if (record.expiresAt < new Date()) {
      return reply.status(400).send({ error: 'TOKEN_EXPIRED', message: request.t('errors.tokenExpired') })
    }

    const passwordHash = await bcrypt.hash(password, BCRYPT_ROUNDS)

    await prisma.$transaction([
      prisma.passwordResetToken.update({ where: { id: record.id }, data: { usedAt: new Date() } }),
      prisma.user.update({ where: { id: record.userId }, data: { passwordHash } }),
      prisma.refreshToken.updateMany({ where: { userId: record.userId, revokedAt: null }, data: { revokedAt: new Date() } }),
    ])

    await prisma.auditLog.create({
      data: { userId: record.userId, action: 'user.passwordReset', ipAddress: request.ip },
    })

    return reply.send({ ok: true })
  })

  // ── 2FA SETUP ──────────────────────────────────────────────────────────────

  fastify.post('/2fa/setup', { onRequest: [fastify.authenticate] }, async (request, reply) => {
    const user = request.user as { id: string }
    const dbUser = await prisma.user.findUniqueOrThrow({ where: { id: user.id } })

    const secret = authenticator.generateSecret()
    const otpAuthUrl = authenticator.keyuri(dbUser.email, 'SocialPlatform', secret)
    const qrCode = await QRCode.toDataURL(otpAuthUrl)

    await prisma.user.update({ where: { id: user.id }, data: { twoFaSecret: secret } })

    return reply.send({ qrCode, secret })
  })

  fastify.post('/2fa/verify-setup', { onRequest: [fastify.authenticate] }, async (request, reply) => {
    const schema = z.object({ code: z.string().length(6) })
    const parsed = schema.safeParse(request.body)
    if (!parsed.success) {
      return reply.status(400).send({ error: 'INVALID_INPUT', message: parsed.error.errors[0]?.message })
    }

    const user = request.user as { id: string }
    const dbUser = await prisma.user.findUniqueOrThrow({ where: { id: user.id } })

    if (!dbUser.twoFaSecret) {
      return reply.status(400).send({ error: 'INVALID_INPUT', message: request.t('errors.unauthorized') })
    }

    const isValid = authenticator.verify({ token: parsed.data.code, secret: dbUser.twoFaSecret })
    if (!isValid) {
      return reply.status(400).send({ error: 'INVALID_2FA_CODE', message: request.t('errors.invalidCredentials') })
    }

    const backupCodes = Array.from({ length: 8 }, () => crypto.randomBytes(4).toString('hex'))

    await prisma.user.update({
      where: { id: user.id },
      data: { twoFaEnabled: true, twoFaBackupCodes: backupCodes },
    })

    await prisma.auditLog.create({
      data: { userId: user.id, action: 'user.2faEnabled', ipAddress: request.ip },
    })

    return reply.send({ backupCodes })
  })

  fastify.post('/2fa/disable', { onRequest: [fastify.authenticate] }, async (request, reply) => {
    const schema = z.object({ password: z.string().min(1) })
    const parsed = schema.safeParse(request.body)
    if (!parsed.success) {
      return reply.status(400).send({ error: 'INVALID_INPUT', message: parsed.error.errors[0]?.message })
    }

    const user = request.user as { id: string }
    const dbUser = await prisma.user.findUniqueOrThrow({ where: { id: user.id } })

    const valid = await bcrypt.compare(parsed.data.password, dbUser.passwordHash)
    if (!valid) {
      return reply.status(401).send({ error: 'INVALID_CREDENTIALS', message: request.t('errors.invalidCredentials') })
    }

    await prisma.user.update({
      where: { id: user.id },
      data: { twoFaEnabled: false, twoFaSecret: null, twoFaBackupCodes: [] },
    })

    await prisma.auditLog.create({
      data: { userId: user.id, action: 'user.2faDisabled', ipAddress: request.ip },
    })

    return reply.send({ ok: true })
  })
}

async function issueTokens(fastify: Parameters<FastifyPluginAsync>[0], userId: string) {
  const accessToken = fastify.jwt.sign({ id: userId }, { expiresIn: JWT_EXPIRY })
  const refreshTokenRaw = generateSecureToken()
  const tokenHash = hashToken(refreshTokenRaw)

  await prisma.refreshToken.create({
    data: {
      userId,
      tokenHash,
      expiresAt: new Date(Date.now() + REFRESH_EXPIRY_DAYS * 24 * 60 * 60 * 1000),
    },
  })

  return { accessToken, refreshTokenRaw }
}
