import type { Platform } from '@social/db'
import { publishToYoutube } from './youtube.js'

export type PublishResult = {
  platformPostId: string
  publishedUrl?: string
}

export type PublishParams = {
  caption: string
  title?: string
  mediaKey?: string
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
    // TikTok e Instagram — implementados nos próximos blocos
    default:
      throw new PlatformNotImplementedError(platform)
  }
}
