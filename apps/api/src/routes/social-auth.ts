import type { FastifyInstance } from 'fastify'
import { z } from 'zod'
import { prisma } from '../lib/prisma.js'
import { getYoutubeAuthUrl, exchangeYoutubeCode } from '../lib/publishers/youtube.js'
import { getTiktokAuthUrl, exchangeTiktokCode } from '../lib/publishers/tiktok.js'
import { getInstagramAuthUrl, exchangeInstagramCode } from '../lib/publishers/instagram.js'
import type { Platform } from '@social/db'

const OAUTH_STATE_TTL_MS = 10 * 60 * 1000 // 10 minutos

// Estado CSRF em memória com TTL — em multi-instance mover para Redis
const pendingStates = new Map<string, { workspaceId: string; clientId: string; expiresAt: number }>()

// ── helpers ────────────────────────────────────────────────────────────────────

function generateState(workspaceId: string, clientId: string): string {
  const state = `${workspaceId}:${clientId}:${Date.now()}`
  pendingStates.set(state, { workspaceId, clientId, expiresAt: Date.now() + OAUTH_STATE_TTL_MS })
  return state
}

function consumeState(state: string): { workspaceId: string; clientId: string } | null {
  const pending = pendingStates.get(state)
  pendingStates.delete(state)
  if (!pending || pending.expiresAt < Date.now()) return null
  return { workspaceId: pending.workspaceId, clientId: pending.clientId }
}

const connectQuerySchema = z.object({ clientId: z.string().uuid().optional() })
const callbackQuerySchema = z.object({
  code: z.string().optional(),
  state: z.string(),
  error: z.string().optional(),
  error_reason: z.string().optional(),
})

async function resolveClientId(
  request: Parameters<Parameters<FastifyInstance['get']>[1]>[0] & {
    workspaceId: string
    clientId?: string
    t: (key: string) => string
  },
  reply: Parameters<Parameters<FastifyInstance['get']>[1]>[1],
  queryClientId?: string,
): Promise<string | null> {
  const clientId = (request as { clientId?: string }).clientId ?? queryClientId
  if (!clientId) {
    reply.status(400).send({ error: 'VALIDATION_ERROR', message: request.t('errors:missingClientId') })
    return null
  }
  const client = await prisma.client.findFirst({
    where: { id: clientId, workspaceId: (request as { workspaceId: string }).workspaceId, deletedAt: null },
  })
  if (!client) {
    reply.status(404).send({ error: 'NOT_FOUND', message: request.t('errors:notFound') })
    return null
  }
  return clientId
}

async function upsertSocialAccount(params: {
  clientId: string
  workspaceId: string
  platform: Platform
  platformUserId: string
  handle: string
  accessToken: string
  refreshToken?: string
  expiresAt?: Date
}) {
  const account = await prisma.socialAccount.upsert({
    where: { clientId_platform: { clientId: params.clientId, platform: params.platform } },
    create: {
      clientId: params.clientId,
      platform: params.platform,
      platformUserId: params.platformUserId,
      handle: params.handle,
      accessToken: params.accessToken,
      refreshToken: params.refreshToken,
      expiresAt: params.expiresAt,
      needsReauth: false,
    },
    update: {
      platformUserId: params.platformUserId,
      handle: params.handle,
      accessToken: params.accessToken,
      ...(params.refreshToken ? { refreshToken: params.refreshToken } : {}),
      ...(params.expiresAt ? { expiresAt: params.expiresAt } : {}),
      needsReauth: false,
    },
  })

  await prisma.auditLog.create({
    data: {
      userId: params.clientId,
      workspaceId: params.workspaceId,
      action: 'socialAccount.connected',
      entity: 'SocialAccount',
      entityId: account.id,
      metadata: { platform: params.platform, handle: params.handle },
    },
  })

  return account
}

// ── rotas ──────────────────────────────────────────────────────────────────────

export const socialAuthRoutes = async (app: FastifyInstance) => {
  const frontendUrl = process.env.APP_URL ?? 'http://localhost:3000'
  const authPreHandler = [app.authenticate, app.requireWorkspace]

  // ── YouTube ──────────────────────────────────────────────────────────────────

  app.get('/youtube/connect', { preHandler: authPreHandler }, async (request, reply) => {
    const q = connectQuerySchema.safeParse(request.query)
    if (!q.success) return reply.status(400).send({ error: 'VALIDATION_ERROR' })

    // @ts-expect-error — request decorators injetados pelos plugins
    const clientId = await resolveClientId(request, reply, q.data.clientId)
    if (!clientId) return

    // @ts-expect-error — workspaceId injetado pelo workspace-context plugin
    const state = generateState(request.workspaceId, clientId)
    return reply.status(200).send({ authUrl: getYoutubeAuthUrl(state) })
  })

  app.get('/youtube/callback', async (request, reply) => {
    const q = callbackQuerySchema.safeParse(request.query)
    if (!q.success) return reply.status(400).send({ error: 'VALIDATION_ERROR' })

    const { code, state, error } = q.data
    if (error) return reply.status(400).send({ error: 'OAUTH_DENIED', message: error })
    if (!code) return reply.status(400).send({ error: 'VALIDATION_ERROR' })

    const pending = consumeState(state)
    if (!pending) return reply.status(400).send({ error: 'INVALID_STATE', message: 'Estado OAuth expirado ou invalido' })

    const tokens = await exchangeYoutubeCode(code)
    await upsertSocialAccount({
      ...pending,
      platform: 'YOUTUBE',
      platformUserId: tokens.channelId,
      handle: tokens.handle,
      accessToken: tokens.accessToken,
      refreshToken: tokens.refreshToken,
      expiresAt: tokens.expiresAt,
    })

    return reply.redirect(`${frontendUrl}/settings/connections?connected=youtube`)
  })

  // ── TikTok ───────────────────────────────────────────────────────────────────

  app.get('/tiktok/connect', { preHandler: authPreHandler }, async (request, reply) => {
    const q = connectQuerySchema.safeParse(request.query)
    if (!q.success) return reply.status(400).send({ error: 'VALIDATION_ERROR' })

    // @ts-expect-error — decorators injetados pelos plugins (workspaceId, clientId)
    const clientId = await resolveClientId(request, reply, q.data.clientId)
    if (!clientId) return

    // @ts-expect-error — workspaceId injetado pelo workspace-context plugin
    const state = generateState(request.workspaceId, clientId)
    return reply.status(200).send({ authUrl: getTiktokAuthUrl(state) })
  })

  app.get('/tiktok/callback', async (request, reply) => {
    const q = callbackQuerySchema.safeParse(request.query)
    if (!q.success) return reply.status(400).send({ error: 'VALIDATION_ERROR' })

    const { code, state, error } = q.data
    if (error) return reply.status(400).send({ error: 'OAUTH_DENIED', message: error })
    if (!code) return reply.status(400).send({ error: 'VALIDATION_ERROR' })

    const pending = consumeState(state)
    if (!pending) return reply.status(400).send({ error: 'INVALID_STATE', message: 'Estado OAuth expirado ou invalido' })

    const tokens = await exchangeTiktokCode(code)
    await upsertSocialAccount({
      ...pending,
      platform: 'TIKTOK',
      platformUserId: tokens.openId,
      handle: tokens.handle,
      accessToken: tokens.accessToken,
      refreshToken: tokens.refreshToken,
      expiresAt: tokens.expiresAt,
    })

    return reply.redirect(`${frontendUrl}/settings/connections?connected=tiktok`)
  })

  // ── Instagram ────────────────────────────────────────────────────────────────

  app.get('/instagram/connect', { preHandler: authPreHandler }, async (request, reply) => {
    const q = connectQuerySchema.safeParse(request.query)
    if (!q.success) return reply.status(400).send({ error: 'VALIDATION_ERROR' })

    // @ts-expect-error — decorators injetados pelos plugins (workspaceId, clientId)
    const clientId = await resolveClientId(request, reply, q.data.clientId)
    if (!clientId) return

    // @ts-expect-error — workspaceId injetado pelo workspace-context plugin
    const state = generateState(request.workspaceId, clientId)
    return reply.status(200).send({ authUrl: getInstagramAuthUrl(state) })
  })

  app.get('/instagram/callback', async (request, reply) => {
    const q = callbackQuerySchema.safeParse(request.query)
    if (!q.success) return reply.status(400).send({ error: 'VALIDATION_ERROR' })

    const { code, state, error } = q.data
    if (error) return reply.status(400).send({ error: 'OAUTH_DENIED', message: error })
    if (!code) return reply.status(400).send({ error: 'VALIDATION_ERROR' })

    const pending = consumeState(state)
    if (!pending) return reply.status(400).send({ error: 'INVALID_STATE', message: 'Estado OAuth expirado ou invalido' })

    const tokens = await exchangeInstagramCode(code)
    await upsertSocialAccount({
      ...pending,
      platform: 'INSTAGRAM',
      platformUserId: tokens.igUserId,
      handle: tokens.handle,
      accessToken: tokens.accessToken,
      expiresAt: tokens.expiresAt,
    })

    return reply.redirect(`${frontendUrl}/settings/connections?connected=instagram`)
  })
}
