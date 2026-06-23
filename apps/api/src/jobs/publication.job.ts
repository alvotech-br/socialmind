import { prisma } from '../lib/prisma.js'
import { publish, PlatformNotImplementedError } from '../lib/publishers/index.js'
import type { PublicationJobData } from '../lib/queue.js'

export async function processPublication(data: PublicationJobData): Promise<void> {
  const { postId } = data

  const post = await prisma.post.findUnique({
    where: { id: postId },
    include: { socialAccount: true },
  })

  if (!post) throw new Error(`Post ${postId} nao encontrado`)
  if (post.status === 'PUBLISHED' || post.status === 'CANCELLED') return

  await prisma.post.update({
    where: { id: postId },
    data: { status: 'PROCESSING', attempts: { increment: 1 } },
  })

  try {
    const result = await publish(post.platform, {
      caption: post.caption,
      mediaKey: post.mediaFileId ?? undefined,
      accessToken: post.socialAccount.accessToken,
      refreshToken: post.socialAccount.refreshToken ?? undefined,
      platformUserId: post.socialAccount.platformUserId,
    })

    await prisma.post.update({
      where: { id: postId },
      data: {
        status: 'PUBLISHED',
        publishedAt: new Date(),
        failureReason: null,
        jobId: result.platformPostId,
      },
    })

    await prisma.auditLog.create({
      data: {
        userId: post.socialAccount.clientId, // clientId como proxy até termos userId no post
        workspaceId: post.workspaceId,
        action: 'post.published',
        entity: 'Post',
        entityId: postId,
        metadata: { platform: post.platform, platformPostId: result.platformPostId },
      },
    })
  } catch (err) {
    const reason = err instanceof Error ? err.message : String(err)
    const isPlatformNotImplemented = err instanceof PlatformNotImplementedError

    await prisma.post.update({
      where: { id: postId },
      data: {
        status: 'FAILED',
        failureReason: reason,
      },
    })

    // Nao relancar para erros de plataforma nao implementada (evita retry infinito)
    if (!isPlatformNotImplemented) throw err
  }
}
