import { Worker } from 'bullmq'
import { processThumbnail } from '../jobs/thumbnail.job.js'
import type { ThumbnailJobData } from '../lib/queue.js'

const redisConnection = {
  host: process.env.REDIS_HOST ?? 'localhost',
  port: Number(process.env.REDIS_PORT ?? 6379),
}

export const thumbnailWorker = new Worker<ThumbnailJobData>(
  'thumbnail',
  async (job) => {
    await processThumbnail(job.data)
  },
  {
    connection: redisConnection,
    concurrency: 2,
  },
)

thumbnailWorker.on('completed', (job) => {
  console.log(`[thumbnail] job ${job.id} concluido — mediaFileId: ${job.data.mediaFileId}`)
})

thumbnailWorker.on('failed', (job, err) => {
  console.error(`[thumbnail] job ${job?.id} falhou — mediaFileId: ${job?.data.mediaFileId}`, err.message)
})
