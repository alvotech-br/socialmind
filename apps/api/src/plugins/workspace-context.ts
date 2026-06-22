import fp from 'fastify-plugin'
import type { FastifyPluginAsync, FastifyRequest, FastifyReply } from 'fastify'
import { prisma } from '../lib/prisma.js'

declare module 'fastify' {
  interface FastifyRequest {
    workspaceId: string
    userRole: 'OWNER' | 'ADMIN' | 'EDITOR' | 'VIEWER'
    accountType: 'AGENCY' | 'SELF'
    clientId: string | null
  }
  interface FastifyInstance {
    requireWorkspace: (request: FastifyRequest, reply: FastifyReply) => Promise<void>
  }
}

const workspaceContextPlugin: FastifyPluginAsync = async (fastify) => {
  fastify.decorate(
    'requireWorkspace',
    async (request: FastifyRequest, reply: FastifyReply) => {
      const user = request.user as { id: string } | undefined
      if (!user) {
        return reply.status(401).send({ error: 'UNAUTHORIZED', message: request.t('errors:unauthorized') })
      }

      const workspaceId =
        (request.headers['x-workspace-id'] as string | undefined) ??
        extractSlugFromHost(request.hostname)

      if (!workspaceId) {
        return reply.status(400).send({ error: 'WORKSPACE_REQUIRED', message: request.t('errors:notFound') })
      }

      const member = await prisma.workspaceMember.findFirst({
        where: { workspaceId, userId: user.id },
        include: { workspace: { select: { accountType: true, deletedAt: true } } },
      })

      if (!member || member.workspace.deletedAt) {
        return reply.status(403).send({ error: 'FORBIDDEN', message: request.t('errors:forbidden') })
      }

      request.workspaceId = workspaceId
      request.userRole = member.role
      request.accountType = member.workspace.accountType

      const clientIdHeader = request.headers['x-client-id'] as string | undefined

      if (clientIdHeader) {
        const client = await prisma.client.findFirst({
          where: { id: clientIdHeader, workspaceId, deletedAt: null },
        })
        if (!client) {
          return reply.status(404).send({ error: 'NOT_FOUND', message: request.t('errors:notFound') })
        }
        request.clientId = clientIdHeader
      } else if (member.workspace.accountType === 'SELF') {
        const selfClient = await prisma.client.findFirst({
          where: { workspaceId, isSelf: true, deletedAt: null },
        })
        request.clientId = selfClient?.id ?? null
      } else {
        request.clientId = null
      }
    },
  )
}

function extractSlugFromHost(hostname: string): string | null {
  const parts = hostname.split('.')
  if (parts.length >= 3) return parts[0] ?? null
  return null
}

export default fp(workspaceContextPlugin, { name: 'workspace-context' })
