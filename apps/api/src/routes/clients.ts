import type { FastifyPluginAsync } from 'fastify'
import { z } from 'zod'
import { prisma } from '../lib/prisma.js'

const EDITABLE_ROLES = ['OWNER', 'ADMIN'] as const
const canEdit = (role: string) => (EDITABLE_ROLES as readonly string[]).includes(role)

export const clientRoutes: FastifyPluginAsync = async (fastify) => {
  // GET /workspaces/:workspaceId/clients
  fastify.get('/', {
    onRequest: [fastify.authenticate, fastify.requireWorkspace],
  }, async (request, reply) => {
    const clients = await prisma.client.findMany({
      where: { workspaceId: request.workspaceId, deletedAt: null },
      include: { _count: { select: { socialAccounts: true } } },
      orderBy: { createdAt: 'asc' },
    })
    return reply.send(clients.map((c) => ({
      id: c.id,
      name: c.name,
      handle: c.handle,
      avatarUrl: c.avatarUrl,
      isSelf: c.isSelf,
      socialAccountsCount: c._count.socialAccounts,
    })))
  })

  // POST /workspaces/:workspaceId/clients
  fastify.post('/', {
    onRequest: [fastify.authenticate, fastify.requireWorkspace],
  }, async (request, reply) => {
    if (request.accountType === 'SELF') {
      return reply.status(403).send({
        error: 'FORBIDDEN',
        message: request.t('errors:selfWorkspaceCannotAddClients'),
      })
    }

    if (!canEdit(request.userRole)) {
      return reply.status(403).send({ error: 'FORBIDDEN', message: request.t('errors:forbidden') })
    }

    const schema = z.object({
      name: z.string().min(1),
      handle: z.string().optional(),
      avatarUrl: z.string().url().optional(),
    })
    const parsed = schema.safeParse(request.body)
    if (!parsed.success) {
      return reply.status(400).send({ error: 'INVALID_INPUT', message: parsed.error.errors[0]?.message })
    }

    const client = await prisma.client.create({
      data: { workspaceId: request.workspaceId, ...parsed.data },
    })

    await prisma.auditLog.create({
      data: {
        userId: (request.user as { id: string }).id,
        workspaceId: request.workspaceId,
        action: 'client.created',
        entity: 'Client',
        entityId: client.id,
        ipAddress: request.ip,
      },
    })

    return reply.status(201).send(client)
  })

  // GET /workspaces/:workspaceId/clients/:id
  fastify.get('/:id', {
    onRequest: [fastify.authenticate, fastify.requireWorkspace],
  }, async (request, reply) => {
    const { id } = request.params as { id: string }
    const client = await prisma.client.findFirst({
      where: { id, workspaceId: request.workspaceId, deletedAt: null },
      include: {
        socialAccounts: {
          select: { id: true, platform: true, handle: true, needsReauth: true, expiresAt: true },
        },
      },
    })
    if (!client) {
      return reply.status(404).send({ error: 'NOT_FOUND', message: request.t('errors:notFound') })
    }
    return reply.send(client)
  })

  // PATCH /workspaces/:workspaceId/clients/:id
  fastify.patch('/:id', {
    onRequest: [fastify.authenticate, fastify.requireWorkspace],
  }, async (request, reply) => {
    if (!canEdit(request.userRole)) {
      return reply.status(403).send({ error: 'FORBIDDEN', message: request.t('errors:forbidden') })
    }

    const { id } = request.params as { id: string }
    const schema = z.object({
      name: z.string().min(1).optional(),
      handle: z.string().optional(),
      avatarUrl: z.string().url().optional(),
    })
    const parsed = schema.safeParse(request.body)
    if (!parsed.success) {
      return reply.status(400).send({ error: 'INVALID_INPUT', message: parsed.error.errors[0]?.message })
    }

    const existing = await prisma.client.findFirst({
      where: { id, workspaceId: request.workspaceId, deletedAt: null },
    })
    if (!existing) {
      return reply.status(404).send({ error: 'NOT_FOUND', message: request.t('errors:notFound') })
    }

    const updated = await prisma.client.update({ where: { id }, data: parsed.data })

    await prisma.auditLog.create({
      data: {
        userId: (request.user as { id: string }).id,
        workspaceId: request.workspaceId,
        action: 'client.updated',
        entity: 'Client',
        entityId: id,
        ipAddress: request.ip,
      },
    })

    return reply.send(updated)
  })

  // DELETE /workspaces/:workspaceId/clients/:id
  fastify.delete('/:id', {
    onRequest: [fastify.authenticate, fastify.requireWorkspace],
  }, async (request, reply) => {
    if (request.userRole !== 'OWNER') {
      return reply.status(403).send({ error: 'FORBIDDEN', message: request.t('errors:forbidden') })
    }

    const { id } = request.params as { id: string }
    const existing = await prisma.client.findFirst({
      where: { id, workspaceId: request.workspaceId, deletedAt: null },
    })
    if (!existing) {
      return reply.status(404).send({ error: 'NOT_FOUND', message: request.t('errors:notFound') })
    }

    if (existing.isSelf) {
      return reply.status(403).send({ error: 'FORBIDDEN', message: request.t('errors:forbidden') })
    }

    await prisma.client.update({ where: { id }, data: { deletedAt: new Date() } })

    await prisma.auditLog.create({
      data: {
        userId: (request.user as { id: string }).id,
        workspaceId: request.workspaceId,
        action: 'client.deleted',
        entity: 'Client',
        entityId: id,
        ipAddress: request.ip,
      },
    })

    return reply.status(204).send()
  })
}
