import type { FastifyPluginAsync } from 'fastify'
import { z } from 'zod'
import { prisma } from '../lib/prisma.js'

const cookieConsentSchema = z.object({
  accepted: z.literal(true),
  sessionId: z.string().min(1),
  version: z.string().default('v1.0'),
  locale: z.enum(['pt-BR', 'es', 'en']).optional(),
})

const linkUserSchema = z.object({
  sessionId: z.string().min(1),
})

export const privacyRoutes: FastifyPluginAsync = async (fastify) => {
  // ── COOKIES ───────────────────────────────────────────────────────────────

  fastify.post('/consents/cookies', async (request, reply) => {
    const parsed = cookieConsentSchema.safeParse(request.body)
    if (!parsed.success) {
      return reply.status(400).send({
        error: 'INVALID_INPUT',
        message: parsed.error.errors[0]?.message ?? request.t('errors:invalidEmail'),
      })
    }

    const { sessionId, version, locale } = parsed.data
    const detectedLocale =
      locale ??
      (request.locale as 'pt-BR' | 'es' | 'en' | undefined) ??
      'pt-BR'

    const record = await prisma.consentRecord.create({
      data: {
        userId: null,
        sessionId,
        consentType: 'COOKIES',
        version,
        ip: request.ip,
        userAgent: request.headers['user-agent'] ?? null,
        locale: detectedLocale,
        metadata: { essential: true, analytics: true, performance: true, experience: true },
      },
    })

    return reply.status(201).send({ recorded: true, consentId: record.id })
  })

  fastify.post('/consents/cookies/link-user', {
    onRequest: [fastify.authenticate],
  }, async (request, reply) => {
    const parsed = linkUserSchema.safeParse(request.body)
    if (!parsed.success) {
      return reply.status(400).send({ error: 'INVALID_INPUT', message: parsed.error.errors[0]?.message })
    }

    const user = request.user as { id: string }
    const { sessionId } = parsed.data

    await prisma.consentRecord.updateMany({
      where: { sessionId, consentType: 'COOKIES', userId: null },
      data: { userId: user.id },
    })

    return reply.send({ linked: true })
  })

  // ── MEUS DADOS ────────────────────────────────────────────────────────────

  fastify.get('/my-data', {
    onRequest: [fastify.authenticate],
  }, async (request, reply) => {
    const user = request.user as { id: string }

    const dbUser = await prisma.user.findUniqueOrThrow({
      where: { id: user.id },
      select: {
        id: true,
        email: true,
        name: true,
        locale: true,
        twoFaEnabled: true,
        createdAt: true,
        updatedAt: true,
        deletedAt: true,
      },
    })

    const workspaces = await prisma.workspaceMember.findMany({
      where: { userId: user.id },
      include: {
        workspace: {
          select: { id: true, name: true, slug: true, accountType: true, planType: true },
        },
      },
    })

    const consents = await prisma.consentRecord.findMany({
      where: { userId: user.id },
      select: { id: true, consentType: true, version: true, acceptedAt: true, locale: true },
    })

    const deletionRequests = await prisma.dataDeletionRequest.findMany({
      where: { userId: user.id },
      select: { id: true, status: true, requestedAt: true, completedAt: true },
    })

    await prisma.auditLog.create({
      data: { userId: user.id, action: 'privacy.dataExported', ipAddress: request.ip },
    })

    return reply.send({ user: dbUser, workspaces, consents, deletionRequests })
  })

  // ── EXCLUSAO DE CONTA ─────────────────────────────────────────────────────

  fastify.post('/delete-account', {
    onRequest: [fastify.authenticate],
  }, async (request, reply) => {
    const schema = z.object({ reason: z.string().optional() })
    const parsed = schema.safeParse(request.body)
    const user = request.user as { id: string }

    const existing = await prisma.dataDeletionRequest.findFirst({
      where: { userId: user.id, status: { in: ['PENDING', 'PROCESSING'] } },
    })
    if (existing) {
      return reply.status(409).send({ error: 'CONFLICT', deletionRequestId: existing.id })
    }

    const deletion = await prisma.dataDeletionRequest.create({
      data: { userId: user.id, reason: parsed.success ? parsed.data.reason : undefined },
    })

    await prisma.auditLog.create({
      data: { userId: user.id, action: 'privacy.deletionRequested', ipAddress: request.ip },
    })

    return reply.status(201).send({ deletionRequestId: deletion.id, status: deletion.status })
  })

  fastify.delete('/delete-account/cancel', {
    onRequest: [fastify.authenticate],
  }, async (request, reply) => {
    const user = request.user as { id: string }

    const existing = await prisma.dataDeletionRequest.findFirst({
      where: { userId: user.id, status: 'PENDING' },
    })
    if (!existing) {
      return reply.status(404).send({ error: 'NOT_FOUND', message: request.t('errors:notFound') })
    }

    await prisma.dataDeletionRequest.update({
      where: { id: existing.id },
      data: { status: 'CANCELLED' },
    })

    await prisma.auditLog.create({
      data: { userId: user.id, action: 'privacy.deletionCancelled', ipAddress: request.ip },
    })

    return reply.send({ cancelled: true })
  })

  // ── CONSENTIMENTOS ────────────────────────────────────────────────────────

  fastify.get('/consents', {
    onRequest: [fastify.authenticate],
  }, async (request, reply) => {
    const user = request.user as { id: string }
    const consents = await prisma.consentRecord.findMany({
      where: { userId: user.id },
      orderBy: { acceptedAt: 'desc' },
    })
    return reply.send(consents)
  })

  fastify.post('/consents', {
    onRequest: [fastify.authenticate],
  }, async (request, reply) => {
    const schema = z.object({
      consentType: z.enum(['TERMS', 'PRIVACY', 'COOKIES']),
      version: z.string().default('v1.0'),
      locale: z.enum(['pt-BR', 'es', 'en']).optional(),
    })
    const parsed = schema.safeParse(request.body)
    if (!parsed.success) {
      return reply.status(400).send({ error: 'INVALID_INPUT', message: parsed.error.errors[0]?.message })
    }

    const user = request.user as { id: string }
    const detectedLocale = parsed.data.locale ?? (request.locale as 'pt-BR' | 'es' | 'en') ?? 'pt-BR'

    const record = await prisma.consentRecord.create({
      data: {
        userId: user.id,
        consentType: parsed.data.consentType,
        version: parsed.data.version,
        ip: request.ip,
        userAgent: request.headers['user-agent'] ?? null,
        locale: detectedLocale,
      },
    })

    return reply.status(201).send({ recorded: true, consentId: record.id })
  })
}
