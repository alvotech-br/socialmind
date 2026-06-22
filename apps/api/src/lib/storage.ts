import { S3Client, PutObjectCommand } from '@aws-sdk/client-s3'
import { getSignedUrl } from '@aws-sdk/s3-request-presigner'

export const ALLOWED_MIME_TYPES = [
  'video/mp4',
  'video/quicktime',
  'video/webm',
  'image/jpeg',
  'image/png',
  'image/webp',
]

export const MAX_FILE_SIZE = 500 * 1024 * 1024 // 500 MB

export const s3 = new S3Client({
  endpoint: process.env.S3_ENDPOINT,
  region: process.env.S3_REGION ?? 'us-east-1',
  credentials: {
    accessKeyId: process.env.S3_ACCESS_KEY_ID ?? '',
    secretAccessKey: process.env.S3_SECRET_ACCESS_KEY ?? '',
  },
  forcePathStyle: true, // obrigatorio para MinIO
})

export const BUCKET = process.env.S3_BUCKET ?? 'socialplatform-local'

export async function createPresignedUploadUrl(params: {
  key: string
  mimeType: string
  size: number
  expiresIn?: number
}): Promise<string> {
  const command = new PutObjectCommand({
    Bucket: BUCKET,
    Key: params.key,
    ContentType: params.mimeType,
    ContentLength: params.size,
  })

  return getSignedUrl(s3, command, {
    expiresIn: params.expiresIn ?? 900, // 15 minutos
  })
}

export function buildPublicUrl(key: string): string {
  const endpoint = (process.env.S3_ENDPOINT ?? 'http://localhost:9000').replace(/\/$/, '')
  return `${endpoint}/${BUCKET}/${key}`
}

export function getExtension(mimeType: string): string {
  const map: Record<string, string> = {
    'video/mp4': 'mp4',
    'video/quicktime': 'mov',
    'video/webm': 'webm',
    'image/jpeg': 'jpg',
    'image/png': 'png',
    'image/webp': 'webp',
  }
  return map[mimeType] ?? 'bin'
}
