import { Queue } from 'bullmq'

const redisConnection = {
  host: process.env.REDIS_HOST ?? 'localhost',
  port: Number(process.env.REDIS_PORT ?? 6379),
}

export const thumbnailQueue = new Queue('thumbnail', {
  connection: redisConnection,
  defaultJobOptions: {
    attempts: 3,
    backoff: { type: 'exponential', delay: 5000 },
    removeOnComplete: { count: 100 },
    removeOnFail: { count: 200 },
  },
})

export type ThumbnailJobData = {
  mediaFileId: string
  key: string
  workspaceId: string
  mimeType: string
}

export const publicationQueue = new Queue('publication', {
  connection: redisConnection,
  defaultJobOptions: {
    attempts: 5,
    backoff: { type: 'exponential', delay: 10000 },
    removeOnComplete: { count: 200 },
    removeOnFail: { count: 500 },
  },
})

export type PublicationJobData = {
  postId: string
  workspaceId: string
}
