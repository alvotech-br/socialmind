import type { FastifyInstance } from 'fastify'
import { z } from 'zod'
import { randomUUID } from 'crypto'
import { prisma } from '../lib/prisma.js'
import { thumbnailQueue } from '../lib/queue.js'
import {
  createPresignedUploadUrl,
  buildPublicUrl,
  getExtension,
  ALLOWED_MIME_TYPES,
  MAX_FILE_SIZE,
} from '../lib/storage.js'

const presignedSchema = z.object({
  filename: z.string().min(1).max(255),
  mimeType: z.enum(ALLOWED_MIME_TYPES as [string, ...string[]]),
  size: z.number().int().positive().max(MAX_FILE_SIZE),
  clientId: z.string().uuid().optional(),
})

const confirmSchema = z.object({
  mediaFileId: z.string().uuid(),
})

export const uploadRoutes = async (app: FastifyInstance) => {
  // POST /uploads/presigned-url
  app.post('/presigned-url', {
    preHandler: [app.authenticate, app.requireWorkspace],
  }, async (request, reply) => {
    const body = presignedSchema.safeParse(request.body)
    if (!body.success) {
      return reply.status(400).send({
        error: 'VALIDATION_ERROR',
        message: body.error.errors[0]?.message,
      })
    }

    const { filename, mimeType, size, clientId: bodyClientId } = body.data

    // clientId: usa o do workspace-context (SELF) ou o enviado (AGENCY)
    const clientId = request.clientId ?? bodyClientId
    if (!clientId) {
      return reply.status(400).send({
        error: 'VALIDATION_ERROR',
        message: request.t('errors:missingClientId'),
      })
    }

    // Garante que o client pertence ao workspace (isolamento multi-tenant)
    const client = await prisma.client.findFirst({
      where: { id: clientId, workspaceId: request.workspaceId, deletedAt: null },
    })
    if (!client) {
      return reply.status(404).send({
        error: 'NOT_FOUND',
        message: request.t('errors:notFound'),
      })
    }

    const ext = getExtension(mimeType)
    const key = `${request.workspaceId}/${clientId}/${randomUUID()}.${ext}`

    const uploadUrl = await createPresignedUploadUrl({ key, mimeType, size })

    const mediaFile = await prisma.mediaFile.create({
      data: {
        workspaceId: request.workspaceId,
        clientId,
        uploadedBy: request.user.id,
        key,
        bucket: process.env.S3_BUCKET ?? 'socialplatform-local',
        mimeType,
        size,
        status: 'PENDING',
      },
    })

    await prisma.auditLog.create({
      data: {
        userId: request.user.id,
        workspaceId: request.workspaceId,
        action: 'media.presignedUrlCreated',
        entity: 'MediaFile',
        entityId: mediaFile.id,
        metadata: { key, mimeType, size: String(size) },
        ipAddress: request.ip,
      },
    })

    return reply.status(201).send({
      uploadUrl,
      mediaFileId: mediaFile.id,
      key,
      expiresIn: 900,
    })
  })

  // POST /uploads/confirm
  app.post('/confirm', {
    preHandler: [app.authenticate, app.requireWorkspace],
  }, async (request, reply) => {
    const body = confirmSchema.safeParse(request.body)
    if (!body.success) {
      return reply.status(400).send({
        error: 'VALIDATION_ERROR',
        message: body.error.errors[0]?.message,
      })
    }

    const mediaFile = await prisma.mediaFile.findFirst({
      where: {
        id: body.data.mediaFileId,
        workspaceId: request.workspaceId,
      },
    })

    if (!mediaFile) {
      return reply.status(404).send({
        error: 'NOT_FOUND',
        message: request.t('errors:notFound'),
      })
    }

    if (mediaFile.status !== 'PENDING') {
      return reply.status(409).send({
        error: 'CONFLICT',
        message: request.t('errors:mediaAlreadyConfirmed'),
      })
    }

    const updated = await prisma.mediaFile.update({
      where: { id: mediaFile.id },
      data: { status: 'READY' },
    })

    await prisma.auditLog.create({
      data: {
        userId: request.user.id,
        workspaceId: request.workspaceId,
        action: 'media.confirmed',
        entity: 'MediaFile',
        entityId: mediaFile.id,
        ipAddress: request.ip,
      },
    })

    // Enfileira thumbnail apenas para videos
    const isVideo = updated.mimeType.startsWith('video/')
    if (isVideo) {
      await thumbnailQueue.add('generate', {
        mediaFileId: updated.id,
        key: updated.key,
        workspaceId: request.workspaceId,
        mimeType: updated.mimeType,
      })
    }

    return reply.status(200).send({
      id: updated.id,
      key: updated.key,
      url: buildPublicUrl(updated.key),
      mimeType: updated.mimeType,
      size: updated.size,
      status: updated.status,
      thumbnailStatus: isVideo ? 'PENDING' : 'SKIPPED',
    })
  })
}
