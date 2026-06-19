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
  fastify.post('/consents/cookies', async (request, reply) => {
    const parsed = cookieConsentSchema.safeParse(request.body)
    if (!parsed.success) {
      return reply.status(400).send({
        error: 'INVALID_INPUT',
        message: parsed.error.errors[0]?.message ?? request.t('errors.invalidEmail'),
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
}
