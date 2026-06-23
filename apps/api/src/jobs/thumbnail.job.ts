import ffmpeg from 'fluent-ffmpeg'
import { createWriteStream, createReadStream } from 'fs'
import { unlink, mkdir } from 'fs/promises'
import { tmpdir } from 'os'
import { join } from 'path'
import { GetObjectCommand, PutObjectCommand } from '@aws-sdk/client-s3'
import { s3, BUCKET } from '../lib/storage.js'
import { prisma } from '../lib/prisma.js'
import type { ThumbnailJobData } from '../lib/queue.js'

const VIDEO_MIME_TYPES = ['video/mp4', 'video/quicktime', 'video/webm']

export async function processThumbnail(data: ThumbnailJobData): Promise<void> {
  const { mediaFileId, key, mimeType } = data

  if (!VIDEO_MIME_TYPES.includes(mimeType)) {
    await prisma.mediaFile.update({
      where: { id: mediaFileId },
      data: { thumbnailStatus: 'SKIPPED' },
    })
    return
  }

  await prisma.mediaFile.update({
    where: { id: mediaFileId },
    data: { thumbnailStatus: 'PROCESSING' },
  })

  const tmpDir = join(tmpdir(), `thumb-${mediaFileId}`)
  const inputPath = join(tmpDir, 'input.mp4')
  const outputPath = join(tmpDir, 'thumb.jpg')

  try {
    await mkdir(tmpDir, { recursive: true })

    // Baixa o video do S3 para disco temporario
    const s3Response = await s3.send(new GetObjectCommand({ Bucket: BUCKET, Key: key }))
    await streamToFile(s3Response.Body as NodeJS.ReadableStream, inputPath)

    // Extrai frame no segundo 1 (ou no inicio se video curto)
    await extractFrame(inputPath, outputPath)

    // Faz upload do thumbnail de volta para o S3
    const thumbnailKey = key.replace(/\.[^.]+$/, '-thumb.jpg')
    const fileStream = createReadStream(outputPath)

    await s3.send(new PutObjectCommand({
      Bucket: BUCKET,
      Key: thumbnailKey,
      Body: fileStream,
      ContentType: 'image/jpeg',
    }))

    await prisma.mediaFile.update({
      where: { id: mediaFileId },
      data: { thumbnailKey, thumbnailStatus: 'READY' },
    })
  } catch (err) {
    await prisma.mediaFile.update({
      where: { id: mediaFileId },
      data: { thumbnailStatus: 'FAILED' },
    })
    throw err
  } finally {
    await unlink(inputPath).catch(() => null)
    await unlink(outputPath).catch(() => null)
  }
}

function streamToFile(stream: NodeJS.ReadableStream, filePath: string): Promise<void> {
  return new Promise((resolve, reject) => {
    const writer = createWriteStream(filePath)
    stream.pipe(writer)
    writer.on('finish', resolve)
    writer.on('error', reject)
  })
}

function extractFrame(inputPath: string, outputPath: string): Promise<void> {
  return new Promise((resolve, reject) => {
    ffmpeg(inputPath)
      .on('end', resolve)
      .on('error', reject)
      .screenshots({
        timestamps: ['00:00:01'],
        filename: 'thumb.jpg',
        folder: outputPath.replace('/thumb.jpg', ''),
        size: '640x?', // largura 640, altura proporcional
      })
  })
}
