import type { FastifyPluginAsync } from 'fastify'
import { z } from 'zod'
import { prisma } from '../lib/prisma.js'

const canEdit = (role: string) => ['OWNER', 'ADMIN'].includes(role)

export const workspaceRoutes: FastifyPluginAsync = async (fastify) => {
  // GET /workspaces
  fastify.get('/', {
    onRequest: [fastify.authenticate],
  }, async (request, reply) => {
    const user = request.user as { id: string }
    const memberships = await prisma.workspaceMember.findMany({
      where: { userId: user.id },
      include: { workspace: true },
    })
    return reply.send(memberships.map((m) => ({
      ...m.workspace,
      role: m.role,
    })))
  })

  // POST /workspaces
  fastify.post('/', {
    onRequest: [fastify.authenticate],
  }, async (request, reply) => {
    const schema = z.object({
      name: z.string().min(1),
      accountType: z.enum(['AGENCY', 'SELF']),
    })
    const parsed = schema.safeParse(request.body)
    if (!parsed.success) {
      return reply.status(400).send({ error: 'INVALID_INPUT', message: parsed.error.errors[0]?.message })
    }

    const user = request.user as { id: string }
    const dbUser = await prisma.user.findUniqueOrThrow({ where: { id: user.id } })
    const slug = `${parsed.data.name.toLowerCase().replace(/\s+/g, '-')}-${Date.now()}`

    const workspace = await prisma.workspace.create({
      data: {
        ownerId: user.id,
        name: parsed.data.name,
        slug,
        accountType: parsed.data.accountType,
        selfOwned: parsed.data.accountType === 'SELF',
        planType: 'TRIAL',
        trialEndsAt: new Date(Date.now() + 14 * 24 * 60 * 60 * 1000),
      },
    })

    await prisma.workspaceMember.create({
      data: { workspaceId: workspace.id, userId: user.id, role: 'OWNER' },
    })

    if (parsed.data.accountType === 'SELF') {
      await prisma.client.create({
        data: { workspaceId: workspace.id, name: dbUser.name, isSelf: true },
      })
    }

    await prisma.auditLog.create({
      data: { userId: user.id, workspaceId: workspace.id, action: 'workspace.created', ipAddress: request.ip },
    })

    return reply.status(201).send(workspace)
  })

  // GET /workspaces/:workspaceId
  fastify.get('/:workspaceId', {
    onRequest: [fastify.authenticate, fastify.requireWorkspace],
  }, async (request, reply) => {
    const workspace = await prisma.workspace.findUnique({
      where: { id: request.workspaceId },
    })
    return reply.send(workspace)
  })

  // PATCH /workspaces/:workspaceId
  fastify.patch('/:workspaceId', {
    onRequest: [fastify.authenticate, fastify.requireWorkspace],
  }, async (request, reply) => {
    if (!canEdit(request.userRole)) {
      return reply.status(403).send({ error: 'FORBIDDEN', message: request.t('errors:forbidden') })
    }

    const schema = z.object({ name: z.string().min(1).optional() })
    const parsed = schema.safeParse(request.body)
    if (!parsed.success) {
      return reply.status(400).send({ error: 'INVALID_INPUT', message: parsed.error.errors[0]?.message })
    }

    const updated = await prisma.workspace.update({
      where: { id: request.workspaceId },
      data: parsed.data,
    })

    await prisma.auditLog.create({
      data: {
        userId: (request.user as { id: string }).id,
        workspaceId: request.workspaceId,
        action: 'workspace.updated',
        ipAddress: request.ip,
      },
    })

    return reply.send(updated)
  })

  // DELETE /workspaces/:workspaceId
  fastify.delete('/:workspaceId', {
    onRequest: [fastify.authenticate, fastify.requireWorkspace],
  }, async (request, reply) => {
    if (request.userRole !== 'OWNER') {
      return reply.status(403).send({ error: 'FORBIDDEN', message: request.t('errors:forbidden') })
    }

    await prisma.workspace.update({
      where: { id: request.workspaceId },
      data: { deletedAt: new Date() },
    })

    await prisma.auditLog.create({
      data: {
        userId: (request.user as { id: string }).id,
        workspaceId: request.workspaceId,
        action: 'workspace.deleted',
        ipAddress: request.ip,
      },
    })

    return reply.status(204).send()
  })

  // ── MEMBERS ───────────────────────────────────────────────────────────────

  // GET /workspaces/:workspaceId/members
  fastify.get('/:workspaceId/members', {
    onRequest: [fastify.authenticate, fastify.requireWorkspace],
  }, async (request, reply) => {
    const members = await prisma.workspaceMember.findMany({
      where: { workspaceId: request.workspaceId },
      include: { user: { select: { id: true, name: true, email: true, locale: true } } },
    })
    return reply.send(members)
  })

  // POST /workspaces/:workspaceId/members
  fastify.post('/:workspaceId/members', {
    onRequest: [fastify.authenticate, fastify.requireWorkspace],
  }, async (request, reply) => {
    if (!canEdit(request.userRole)) {
      return reply.status(403).send({ error: 'FORBIDDEN', message: request.t('errors:forbidden') })
    }

    const schema = z.object({
      email: z.string().email(),
      role: z.enum(['ADMIN', 'EDITOR', 'VIEWER']),
    })
    const parsed = schema.safeParse(request.body)
    if (!parsed.success) {
      return reply.status(400).send({ error: 'INVALID_INPUT', message: parsed.error.errors[0]?.message })
    }

    const targetUser = await prisma.user.findUnique({ where: { email: parsed.data.email, deletedAt: null } })
    if (!targetUser) {
      return reply.status(404).send({ error: 'NOT_FOUND', message: request.t('errors:notFound') })
    }

    const member = await prisma.workspaceMember.create({
      data: { workspaceId: request.workspaceId, userId: targetUser.id, role: parsed.data.role },
      include: { user: { select: { id: true, name: true, email: true } } },
    })

    await prisma.auditLog.create({
      data: {
        userId: (request.user as { id: string }).id,
        workspaceId: request.workspaceId,
        action: 'member.added',
        entity: 'User',
        entityId: targetUser.id,
        ipAddress: request.ip,
      },
    })

    return reply.status(201).send(member)
  })

  // PATCH /workspaces/:workspaceId/members/:userId
  fastify.patch('/:workspaceId/members/:userId', {
    onRequest: [fastify.authenticate, fastify.requireWorkspace],
  }, async (request, reply) => {
    if (!canEdit(request.userRole)) {
      return reply.status(403).send({ error: 'FORBIDDEN', message: request.t('errors:forbidden') })
    }

    const { userId } = request.params as { userId: string }
    const schema = z.object({ role: z.enum(['ADMIN', 'EDITOR', 'VIEWER']) })
    const parsed = schema.safeParse(request.body)
    if (!parsed.success) {
      return reply.status(400).send({ error: 'INVALID_INPUT', message: parsed.error.errors[0]?.message })
    }

    const existing = await prisma.workspaceMember.findUnique({
      where: { workspaceId_userId: { workspaceId: request.workspaceId, userId } },
    })
    if (!existing) {
      return reply.status(404).send({ error: 'NOT_FOUND', message: request.t('errors:notFound') })
    }
    if (existing.role === 'OWNER') {
      return reply.status(403).send({ error: 'FORBIDDEN', message: request.t('errors:forbidden') })
    }

    const updated = await prisma.workspaceMember.update({
      where: { workspaceId_userId: { workspaceId: request.workspaceId, userId } },
      data: { role: parsed.data.role },
    })

    await prisma.auditLog.create({
      data: {
        userId: (request.user as { id: string }).id,
        workspaceId: request.workspaceId,
        action: 'member.roleChanged',
        entity: 'User',
        entityId: userId,
        metadata: { newRole: parsed.data.role },
        ipAddress: request.ip,
      },
    })

    return reply.send(updated)
  })

  // DELETE /workspaces/:workspaceId/members/:userId
  fastify.delete('/:workspaceId/members/:userId', {
    onRequest: [fastify.authenticate, fastify.requireWorkspace],
  }, async (request, reply) => {
    if (!canEdit(request.userRole)) {
      return reply.status(403).send({ error: 'FORBIDDEN', message: request.t('errors:forbidden') })
    }

    const { userId } = request.params as { userId: string }
    const existing = await prisma.workspaceMember.findUnique({
      where: { workspaceId_userId: { workspaceId: request.workspaceId, userId } },
    })
    if (!existing) {
      return reply.status(404).send({ error: 'NOT_FOUND', message: request.t('errors:notFound') })
    }
    if (existing.role === 'OWNER') {
      return reply.status(403).send({ error: 'FORBIDDEN', message: request.t('errors:forbidden') })
    }

    await prisma.workspaceMember.delete({
      where: { workspaceId_userId: { workspaceId: request.workspaceId, userId } },
    })

    await prisma.auditLog.create({
      data: {
        userId: (request.user as { id: string }).id,
        workspaceId: request.workspaceId,
        action: 'member.removed',
        entity: 'User',
        entityId: userId,
        ipAddress: request.ip,
      },
    })

    return reply.status(204).send()
  })
}
