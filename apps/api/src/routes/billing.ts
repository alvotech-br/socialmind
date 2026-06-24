import type { FastifyInstance } from 'fastify'
import { z } from 'zod'
import { prisma } from '../lib/prisma.js'
import { stripe, PRICE_IDS } from '../lib/stripe.js'

export const billingRoutes = async (app: FastifyInstance) => {

  // POST /billing/checkout
  // Cria sessão de checkout do Stripe para upgrade de plano
  app.post('/checkout', {
    preHandler: [app.authenticate, app.requireWorkspace],
  }, async (request, reply) => {
    const body = z.object({
      plan: z.enum(['STARTER', 'PRO', 'AGENCY']),
    }).safeParse(request.body)

    if (!body.success) {
      return reply.status(400).send({ error: 'VALIDATION_ERROR' })
    }

    const { plan } = body.data
    const priceId = PRICE_IDS[plan]
    if (!priceId) {
      return reply.status(400).send({
        error: 'INVALID_PLAN',
        message: 'Plano inválido ou não configurado',
      })
    }

    const workspace = await prisma.workspace.findUnique({
      where: { id: request.workspaceId },
    })
    if (!workspace) {
      return reply.status(404).send({ error: 'NOT_FOUND' })
    }

    // Cria ou reutiliza customer do Stripe
    let customerId = workspace.stripeCustomerId
    if (!customerId) {
      const user = await prisma.user.findUnique({ where: { id: (request.user as { id: string }).id } })
      const customer = await stripe.customers.create({
        email: user?.email ?? undefined,
        name: workspace.name,
        metadata: { workspaceId: workspace.id },
      })
      customerId = customer.id
      await prisma.workspace.update({
        where: { id: workspace.id },
        data: { stripeCustomerId: customerId },
      })
    }

    const appUrl = process.env.APP_URL ?? 'http://localhost:3000'
    const session = await stripe.checkout.sessions.create({
      customer: customerId,
      mode: 'subscription',
      line_items: [{ price: priceId, quantity: 1 }],
      success_url: `${appUrl}/pt-BR/settings/billing?success=1`,
      cancel_url: `${appUrl}/pt-BR/settings/billing?cancelled=1`,
      metadata: { workspaceId: workspace.id, plan },
      subscription_data: {
        metadata: { workspaceId: workspace.id, plan },
      },
    })

    await prisma.auditLog.create({
      data: {
        userId: (request.user as { id: string }).id,
        workspaceId: workspace.id,
        action: 'billing.checkoutStarted',
        entity: 'Workspace',
        entityId: workspace.id,
        metadata: { plan, sessionId: session.id },
      },
    })

    return reply.status(200).send({ url: session.url })
  })

  // POST /billing/portal
  // Abre o portal de gerenciamento de assinatura do Stripe
  app.post('/portal', {
    preHandler: [app.authenticate, app.requireWorkspace],
  }, async (request, reply) => {
    const workspace = await prisma.workspace.findUnique({
      where: { id: request.workspaceId },
    })
    if (!workspace?.stripeCustomerId) {
      return reply.status(400).send({
        error: 'NO_SUBSCRIPTION',
        message: 'Workspace não tem assinatura ativa',
      })
    }

    const appUrl = process.env.APP_URL ?? 'http://localhost:3000'
    const session = await stripe.billingPortal.sessions.create({
      customer: workspace.stripeCustomerId,
      return_url: `${appUrl}/pt-BR/settings/billing`,
    })

    return reply.status(200).send({ url: session.url })
  })

  // GET /billing/status
  // Retorna o plano e status da assinatura do workspace
  app.get('/status', {
    preHandler: [app.authenticate, app.requireWorkspace],
  }, async (request, reply) => {
    const workspace = await prisma.workspace.findUnique({
      where: { id: request.workspaceId },
      select: {
        planType: true,
        trialEndsAt: true,
        stripeSubscriptionId: true,
        postsThisMonth: true,
      },
    })
    if (!workspace) return reply.status(404).send({ error: 'NOT_FOUND' })

    let subscriptionStatus: string | null = null
    if (workspace.stripeSubscriptionId) {
      const sub = await stripe.subscriptions.retrieve(workspace.stripeSubscriptionId)
      subscriptionStatus = sub.status
    }

    return reply.status(200).send({
      plan: workspace.planType,
      trialEndsAt: workspace.trialEndsAt,
      subscriptionStatus,
      postsThisMonth: workspace.postsThisMonth,
    })
  })
}
