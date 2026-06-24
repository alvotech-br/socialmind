import { Worker } from 'bullmq'
import { processPublication } from '../jobs/publication.job.js'
import type { PublicationJobData } from '../lib/queue.js'

const redisConnection = {
  host: process.env.REDIS_HOST ?? 'localhost',
  port: Number(process.env.REDIS_PORT ?? 6379),
}

export const publicationWorker = new Worker<PublicationJobData>(
  'publication',
  async (job) => {
    await processPublication(job.data)
  },
  {
    connection: redisConnection,
    concurrency: 5,
  },
)

publicationWorker.on('completed', (job) => {
  console.log(`[publication] job ${job.id} concluido — postId: ${job.data.postId}`)
})

publicationWorker.on('failed', (job, err) => {
  console.error(`[publication] job ${job?.id} falhou — postId: ${job?.data.postId}`, err.message)
})
