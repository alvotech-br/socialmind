import { google } from 'googleapis'
import type { OAuth2Client } from 'google-auth-library'
import { createReadStream } from 'fs'
import { unlink, mkdir, writeFile } from 'fs/promises'
import { tmpdir } from 'os'
import { join } from 'path'
import { GetObjectCommand } from '@aws-sdk/client-s3'
import { s3, BUCKET } from '../storage.js'
import { prisma } from '../prisma.js'
import type { PublishParams, PublishResult } from './index.js'

const YOUTUBE_SCOPES = [
  'https://www.googleapis.com/auth/youtube.upload',
  'https://www.googleapis.com/auth/youtube.readonly',
]

export function createOAuth2Client(): OAuth2Client {
  return new google.auth.OAuth2(
    process.env.YOUTUBE_CLIENT_ID,
    process.env.YOUTUBE_CLIENT_SECRET,
    process.env.YOUTUBE_REDIRECT_URI,
  )
}

export function getYoutubeAuthUrl(state: string): string {
  const oauth2 = createOAuth2Client()
  return oauth2.generateAuthUrl({
    access_type: 'offline',
    scope: YOUTUBE_SCOPES,
    state,
    prompt: 'consent', // garante refresh_token sempre
  })
}

export async function exchangeYoutubeCode(code: string): Promise<{
  accessToken: string
  refreshToken: string
  expiresAt: Date
  channelId: string
  handle: string
}> {
  const oauth2 = createOAuth2Client()
  const { tokens } = await oauth2.getToken(code)

  oauth2.setCredentials(tokens)
  const youtube = google.youtube({ version: 'v3', auth: oauth2 })

  const channelRes = await youtube.channels.list({
    part: ['id', 'snippet'],
    mine: true,
  })

  const channel = channelRes.data.items?.[0]
  if (!channel?.id) throw new Error('Canal do YouTube nao encontrado')

  return {
    accessToken: tokens.access_token!,
    refreshToken: tokens.refresh_token!,
    expiresAt: new Date(tokens.expiry_date!),
    channelId: channel.id,
    handle: channel.snippet?.customUrl ?? channel.snippet?.title ?? channel.id,
  }
}

export async function publishToYoutube(
  params: PublishParams & { title?: string; socialAccountId: string },
): Promise<PublishResult> {
  const oauth2 = createOAuth2Client()
  oauth2.setCredentials({
    access_token: params.accessToken,
    refresh_token: params.refreshToken,
  })

  // Atualiza tokens no banco se forem renovados
  oauth2.on('tokens', async (tokens) => {
    await prisma.socialAccount.update({
      where: { id: params.socialAccountId },
      data: {
        accessToken: tokens.access_token ?? params.accessToken,
        ...(tokens.refresh_token ? { refreshToken: tokens.refresh_token } : {}),
        ...(tokens.expiry_date ? { expiresAt: new Date(tokens.expiry_date) } : {}),
        needsReauth: false,
      },
    })
  })

  const youtube = google.youtube({ version: 'v3', auth: oauth2 })

  const title = params.title ?? params.caption.split('\n')[0].slice(0, 100)
  const description = params.caption

  // Se tem mediaKey, baixa o video do S3 para arquivo temporario
  let videoPath: string | null = null
  if (params.mediaKey) {
    const tmpDir = join(tmpdir(), `yt-upload-${Date.now()}`)
    await mkdir(tmpDir, { recursive: true })
    videoPath = join(tmpDir, 'video.mp4')

    const s3Response = await s3.send(new GetObjectCommand({ Bucket: BUCKET, Key: params.mediaKey }))
    const chunks: Buffer[] = []
    for await (const chunk of s3Response.Body as AsyncIterable<Buffer>) {
      chunks.push(chunk)
    }
    await writeFile(videoPath, Buffer.concat(chunks))
  }

  try {
    const res = await youtube.videos.insert({
      part: ['snippet', 'status'],
      requestBody: {
        snippet: { title, description, categoryId: '22' }, // 22 = People & Blogs
        status: { privacyStatus: 'public' },
      },
      media: videoPath
        ? { body: createReadStream(videoPath) }
        : undefined,
    })

    const videoId = res.data.id!
    return {
      platformPostId: videoId,
      publishedUrl: `https://www.youtube.com/watch?v=${videoId}`,
    }
  } finally {
    if (videoPath) await unlink(videoPath).catch(() => null)
  }
}
