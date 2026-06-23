import type { Platform } from '@social/db'
import { publishToYoutube } from './youtube.js'
import { publishToTiktok } from './tiktok.js'
import { publishToInstagram } from './instagram.js'

export type PublishResult = {
  platformPostId: string
  publishedUrl?: string
}

export type PublishParams = {
  caption: string
  title?: string
  mediaKey?: string
  videoUrl?: string  // URL pública S3 — usada por TikTok (PULL_FROM_URL) e Instagram
  accessToken: string
  refreshToken?: string
  platformUserId: string
  socialAccountId: string
}

export class PlatformNotImplementedError extends Error {
  constructor(platform: Platform) {
    super(`Publisher not implemented for platform: ${platform}`)
    this.name = 'PlatformNotImplementedError'
  }
}

export async function publish(platform: Platform, params: PublishParams): Promise<PublishResult> {
  switch (platform) {
    case 'YOUTUBE':
      return publishToYoutube(params)
    case 'TIKTOK':
      return publishToTiktok(params)
    case 'INSTAGRAM':
      return publishToInstagram(params)
    default:
      throw new PlatformNotImplementedError(platform)
  }
}
