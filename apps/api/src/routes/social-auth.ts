import type { FastifyInstance } from 'fastify'
import { z } from 'zod'
import { prisma } from '../lib/prisma.js'
import { getYoutubeAuthUrl, exchangeYoutubeCode } from '../lib/publishers/youtube.js'

const OAUTH_STATE_TTL_MS = 10 * 60 * 1000 // 10 minutos

// Estado CSRF em memória (suficiente para single-instance; em multi-instance usar Redis)
const pendingStates = new Map<string, { workspaceId: string; clientId: string; expiresAt: number }>()

export const socialAuthRoutes = async (app: FastifyInstance) => {
  // GET /social-auth/youtube/connect
  // Gera a URL de autorizacao e redireciona o usuario para o Google
  app.get('/youtube/connect', {
    preHandler: [app.authenticate, app.requireWorkspace],
  }, async (request, reply) => {
    const query = z.object({
      clientId: z.string().uuid().optional(),
    }).safeParse(request.query)

    if (!query.success) {
      return reply.status(400).send({ error: 'VALIDATION_ERROR' })
    }

    const clientId = request.clientId ?? query.data.clientId
    if (!clientId) {
      return reply.status(400).send({
        error: 'VALIDATION_ERROR',
        message: request.t('errors:missingClientId'),
      })
    }

    // Valida que o client pertence ao workspace
    const client = await prisma.client.findFirst({
      where: { id: clientId, workspaceId: request.workspaceId, deletedAt: null },
    })
    if (!client) {
      return reply.status(404).send({
        error: 'NOT_FOUND',
        message: request.t('errors:notFound'),
      })
    }

    const state = `${request.workspaceId}:${clientId}:${Date.now()}`
    pendingStates.set(state, {
      workspaceId: request.workspaceId,
      clientId,
      expiresAt: Date.now() + OAUTH_STATE_TTL_MS,
    })

    const authUrl = getYoutubeAuthUrl(state)
    return reply.status(200).send({ authUrl })
  })

  // GET /social-auth/youtube/callback
  // Google redireciona aqui apos autorizacao — troca o code por tokens
  app.get('/youtube/callback', async (request, reply) => {
    const query = z.object({
      code: z.string(),
      state: z.string(),
      error: z.string().optional(),
    }).safeParse(request.query)

    if (!query.success) {
      return reply.status(400).send({ error: 'VALIDATION_ERROR' })
    }

    const { code, state, error } = query.data

    if (error) {
      return reply.status(400).send({ error: 'OAUTH_DENIED', message: error })
    }

    const pending = pendingStates.get(state)
    if (!pending || pending.expiresAt < Date.now()) {
      pendingStates.delete(state)
      return reply.status(400).send({ error: 'INVALID_STATE', message: 'Estado OAuth expirado ou invalido' })
    }

    pendingStates.delete(state)
    const { workspaceId, clientId } = pending

    const tokens = await exchangeYoutubeCode(code)

    // Upsert da SocialAccount — reconecta se ja existia
    const socialAccount = await prisma.socialAccount.upsert({
      where: { clientId_platform: { clientId, platform: 'YOUTUBE' } },
      create: {
        clientId,
        platform: 'YOUTUBE',
        platformUserId: tokens.channelId,
        handle: tokens.handle,
        accessToken: tokens.accessToken,
        refreshToken: tokens.refreshToken,
        expiresAt: tokens.expiresAt,
        needsReauth: false,
      },
      update: {
        platformUserId: tokens.channelId,
        handle: tokens.handle,
        accessToken: tokens.accessToken,
        refreshToken: tokens.refreshToken,
        expiresAt: tokens.expiresAt,
        needsReauth: false,
      },
    })

    await prisma.auditLog.create({
      data: {
        userId: clientId, // proxy — OAuth callback nao tem JWT
        workspaceId,
        action: 'socialAccount.connected',
        entity: 'SocialAccount',
        entityId: socialAccount.id,
        metadata: { platform: 'YOUTUBE', handle: tokens.handle },
      },
    })

    // Redireciona para o frontend apos conectar
    const frontendUrl = process.env.APP_URL ?? 'http://localhost:3000'
    return reply.redirect(`${frontendUrl}/settings/connections?connected=youtube`)
  })
}
