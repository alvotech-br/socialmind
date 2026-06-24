import type { FastifyInstance, FastifyRequest } from 'fastify'
import type Stripe from 'stripe'
import { prisma } from '../lib/prisma.js'
import { stripe } from '../lib/stripe.js'

function planFromMetadata(metadata: Stripe.Metadata): 'STARTER' | 'PRO' | 'AGENCY' | null {
  const plan = metadata.plan as string
  if (plan === 'STARTER' || plan === 'PRO' || plan === 'AGENCY') return plan
  return null
}

export const webhookRoutes = async (app: FastifyInstance) => {
  // Captura o body bruto antes do JSON parser — obrigatório para verificar assinatura Stripe
  app.addContentTypeParser(
    'application/json',
    { parseAs: 'buffer' },
    (_req: FastifyRequest, body: Buffer, done: (err: Error | null, body?: unknown) => void) => {
      done(null, body)
    },
  )

  app.post('/stripe', async (request, reply) => {
    const sig = request.headers['stripe-signature'] as string
    const webhookSecret = process.env.STRIPE_WEBHOOK_SECRET ?? ''
    const rawBody = request.body as Buffer

    let event: Stripe.Event
    try {
      event = stripe.webhooks.constructEvent(rawBody, sig, webhookSecret)
    } catch {
      return reply.status(400).send({ error: 'Invalid signature' })
    }

    switch (event.type) {
      case 'checkout.session.completed': {
        const session = event.data.object as Stripe.Checkout.Session
        const workspaceId = session.metadata?.workspaceId
        const plan = planFromMetadata(session.metadata ?? {})
        const subscriptionId = session.subscription as string

        if (workspaceId && plan) {
          await prisma.workspace.update({
            where: { id: workspaceId },
            data: { planType: plan, stripeSubscriptionId: subscriptionId, trialEndsAt: null },
          })
          await prisma.auditLog.create({
            data: {
              userId: workspaceId,
              workspaceId,
              action: 'billing.subscriptionActivated',
              entity: 'Workspace',
              entityId: workspaceId,
              metadata: { plan, subscriptionId },
            },
          })
        }
        break
      }

      case 'customer.subscription.updated': {
        const sub = event.data.object as Stripe.Subscription
        const workspaceId = sub.metadata?.workspaceId
        const plan = planFromMetadata(sub.metadata ?? {})
        const priceId = sub.items.data[0]?.price?.id

        if (workspaceId) {
          await prisma.workspace.update({
            where: { id: workspaceId },
            data: {
              ...(plan ? { planType: plan } : {}),
              stripePriceId: priceId,
              stripeSubscriptionId: sub.id,
            },
          })
        }
        break
      }

      case 'customer.subscription.deleted': {
        const sub = event.data.object as Stripe.Subscription
        const workspaceId = sub.metadata?.workspaceId

        if (workspaceId) {
          await prisma.workspace.update({
            where: { id: workspaceId },
            data: { planType: 'TRIAL', stripeSubscriptionId: null, stripePriceId: null },
          })
          await prisma.auditLog.create({
            data: {
              userId: workspaceId,
              workspaceId,
              action: 'billing.subscriptionCancelled',
              entity: 'Workspace',
              entityId: workspaceId,
              metadata: { subscriptionId: sub.id },
            },
          })
        }
        break
      }

      case 'invoice.payment_failed': {
        const invoice = event.data.object as Stripe.Invoice
        const customerId = invoice.customer as string

        const workspace = await prisma.workspace.findFirst({
          where: { stripeCustomerId: customerId },
        })
        if (workspace) {
          await prisma.auditLog.create({
            data: {
              userId: workspace.id,
              workspaceId: workspace.id,
              action: 'billing.paymentFailed',
              entity: 'Workspace',
              entityId: workspace.id,
              metadata: { invoiceId: invoice.id, amount: invoice.amount_due },
            },
          })
        }
        break
      }
    }

    return reply.status(200).send({ received: true })
  })
}
