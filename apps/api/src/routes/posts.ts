import type { FastifyInstance } from 'fastify'
import { z } from 'zod'
import { prisma } from '../lib/prisma.js'
import { publicationQueue } from '../lib/queue.js'
import { enforcePostQuota } from '../plugins/quota.js'

const createPostSchema = z.object({
  socialAccountId: z.string().uuid(),
  mediaFileId: z.string().uuid().optional(),
  caption: z.string().min(1).max(2200),
  scheduledAt: z.string().datetime(),
})

const PLATFORMS = ['INSTAGRAM', 'TIKTOK', 'YOUTUBE'] as const

export const postRoutes = async (app: FastifyInstance) => {
  // POST /workspaces/:workspaceId/posts
  app.post('/', {
    preHandler: [app.authenticate, app.requireWorkspace, enforcePostQuota as never],
  }, async (request, reply) => {
    const body = createPostSchema.safeParse(request.body)
    if (!body.success) {
      return reply.status(400).send({
        error: 'VALIDATION_ERROR',
        message: body.error.errors[0]?.message,
      })
    }

    const { socialAccountId, mediaFileId, caption, scheduledAt } = body.data

    // Valida que a SocialAccount pertence ao workspace via Client
    const socialAccount = await prisma.socialAccount.findFirst({
      where: {
        id: socialAccountId,
        client: { workspaceId: request.workspaceId, deletedAt: null },
      },
    })
    if (!socialAccount) {
      return reply.status(404).send({
        error: 'NOT_FOUND',
        message: request.t('errors:notFound'),
      })
    }

    // Valida que o mediaFile pertence ao workspace e está READY
    if (mediaFileId) {
      const media = await prisma.mediaFile.findFirst({
        where: { id: mediaFileId, workspaceId: request.workspaceId, status: 'READY' },
      })
      if (!media) {
        return reply.status(404).send({
          error: 'NOT_FOUND',
          message: request.t('errors:mediaNotReady'),
        })
      }
    }

    const scheduledDate = new Date(scheduledAt)
    const isPast = scheduledDate <= new Date()

    const post = await prisma.post.create({
      data: {
        workspaceId: request.workspaceId,
        clientId: socialAccount.clientId,
        socialAccountId,
        mediaFileId: mediaFileId ?? null,
        caption,
        platform: socialAccount.platform,
        scheduledAt: scheduledDate,
        status: isPast ? 'PROCESSING' : 'SCHEDULED',
      },
    })

    // Se agendado para o passado ou imediato, enfileira agora
    const delay = isPast ? 0 : scheduledDate.getTime() - Date.now()
    const job = await publicationQueue.add('publish', {
      postId: post.id,
      workspaceId: request.workspaceId,
    }, { delay })

    await prisma.post.update({
      where: { id: post.id },
      data: { jobId: job.id ?? null },
    })

    // Incrementa contador de posts do mês
    await prisma.workspace.update({
      where: { id: request.workspaceId },
      data: { postsThisMonth: { increment: 1 } },
    })

    await prisma.auditLog.create({
      data: {
        userId: request.user.id,
        workspaceId: request.workspaceId,
        action: 'post.scheduled',
        entity: 'Post',
        entityId: post.id,
        metadata: { platform: post.platform, scheduledAt },
        ipAddress: request.ip,
      },
    })

    return reply.status(201).send({
      id: post.id,
      platform: post.platform,
      status: post.status,
      scheduledAt: post.scheduledAt,
      caption: post.caption,
    })
  })

  // GET /workspaces/:workspaceId/posts
  app.get('/', {
    preHandler: [app.authenticate, app.requireWorkspace],
  }, async (request, reply) => {
    const query = z.object({
      status: z.enum(['DRAFT', 'SCHEDULED', 'PROCESSING', 'PUBLISHED', 'FAILED', 'CANCELLED']).optional(),
      platform: z.enum(PLATFORMS).optional(),
      page: z.coerce.number().int().positive().default(1),
      limit: z.coerce.number().int().positive().max(100).default(20),
    }).safeParse(request.query)

    if (!query.success) {
      return reply.status(400).send({ error: 'VALIDATION_ERROR' })
    }

    const { status, platform, page, limit } = query.data
    const skip = (page - 1) * limit

    const [posts, total] = await Promise.all([
      prisma.post.findMany({
        where: {
          workspaceId: request.workspaceId,
          ...(status ? { status } : {}),
          ...(platform ? { platform } : {}),
        },
        orderBy: { scheduledAt: 'desc' },
        skip,
        take: limit,
        select: {
          id: true,
          platform: true,
          status: true,
          caption: true,
          scheduledAt: true,
          publishedAt: true,
          failureReason: true,
          attempts: true,
        },
      }),
      prisma.post.count({
        where: {
          workspaceId: request.workspaceId,
          ...(status ? { status } : {}),
          ...(platform ? { platform } : {}),
        },
      }),
    ])

    return reply.status(200).send({ posts, total, page, limit })
  })

  // GET /workspaces/:workspaceId/posts/:postId
  app.get('/:postId', {
    preHandler: [app.authenticate, app.requireWorkspace],
  }, async (request, reply) => {
    const { postId } = request.params as { postId: string }

    const post = await prisma.post.findFirst({
      where: { id: postId, workspaceId: request.workspaceId },
      include: {
        socialAccount: { select: { platform: true, handle: true } },
        mediaFile: { select: { id: true, key: true, thumbnailKey: true } },
      },
    })

    if (!post) {
      return reply.status(404).send({
        error: 'NOT_FOUND',
        message: request.t('errors:notFound'),
      })
    }

    return reply.status(200).send(post)
  })

  // DELETE /workspaces/:workspaceId/posts/:postId — cancela post agendado
  app.delete('/:postId', {
    preHandler: [app.authenticate, app.requireWorkspace],
  }, async (request, reply) => {
    const { postId } = request.params as { postId: string }

    const post = await prisma.post.findFirst({
      where: { id: postId, workspaceId: request.workspaceId },
    })

    if (!post) {
      return reply.status(404).send({
        error: 'NOT_FOUND',
        message: request.t('errors:notFound'),
      })
    }

    if (!['DRAFT', 'SCHEDULED', 'FAILED'].includes(post.status)) {
      return reply.status(409).send({
        error: 'CONFLICT',
        message: request.t('errors:postCannotBeCancelled'),
      })
    }

    await prisma.post.update({
      where: { id: postId },
      data: { status: 'CANCELLED' },
    })

    await prisma.auditLog.create({
      data: {
        userId: request.user.id,
        workspaceId: request.workspaceId,
        action: 'post.cancelled',
        entity: 'Post',
        entityId: postId,
        ipAddress: request.ip,
      },
    })

    return reply.status(200).send({ cancelled: true })
  })
}
