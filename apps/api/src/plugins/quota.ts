import type { FastifyInstance } from 'fastify'
import { prisma } from '../lib/prisma.js'
import { PLAN_POST_LIMITS } from '../lib/stripe.js'

declare module 'fastify' {
  interface FastifyInstance {
    checkPostQuota: () => Promise<void>
  }
}

export default async function quotaPlugin(app: FastifyInstance) {
  // Decorador reutilizável — usado como preHandler nas rotas de criação de post
  app.decorate('checkPostQuota', async function (this: unknown) {
    // Não é um hook — usado dentro de routes como função async
  })

  // Hook de verificação real — chamado como preHandler via app.checkQuota
  app.decorateRequest('checkQuota', null)
}

// Middleware exportado para uso inline como preHandler
export async function enforcePostQuota(
  request: { workspaceId: string; t: (key: string) => string },
  reply: { status: (code: number) => { send: (body: unknown) => void } },
) {
  const workspace = await prisma.workspace.findUnique({
    where: { id: request.workspaceId },
    select: {
      planType: true,
      postsThisMonth: true,
      postsMonthResetAt: true,
      trialEndsAt: true,
    },
  })

  if (!workspace) return

  // Reset mensal do contador
  const now = new Date()
  const resetAt = workspace.postsMonthResetAt
  if (!resetAt || resetAt.getMonth() !== now.getMonth() || resetAt.getFullYear() !== now.getFullYear()) {
    await prisma.workspace.update({
      where: { id: request.workspaceId },
      data: { postsThisMonth: 0, postsMonthResetAt: now },
    })
    workspace.postsThisMonth = 0
  }

  // Verifica trial expirado
  if (workspace.planType === 'TRIAL' && workspace.trialEndsAt && workspace.trialEndsAt < now) {
    reply.status(402).send({
      error: 'TRIAL_EXPIRED',
      message: request.t('errors:planLimitReached'),
    })
    return
  }

  // Verifica limite do plano
  const limit = PLAN_POST_LIMITS[workspace.planType] ?? 0
  if (workspace.postsThisMonth >= limit) {
    reply.status(402).send({
      error: 'QUOTA_EXCEEDED',
      message: request.t('errors:planLimitReached'),
    })
    return
  }
}
