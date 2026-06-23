import type { Platform } from '@social/db'

export type PublishResult = {
  platformPostId: string
  publishedUrl?: string
}

export type PublishParams = {
  caption: string
  mediaKey?: string
  accessToken: string
  refreshToken?: string
  platformUserId: string
}

export class PlatformNotImplementedError extends Error {
  constructor(platform: Platform) {
    super(`Publisher not implemented for platform: ${platform}`)
    this.name = 'PlatformNotImplementedError'
  }
}

// Stubs — substituídos pelos blocos de integração (YouTube, TikTok, Instagram)
export async function publish(platform: Platform, params: PublishParams): Promise<PublishResult> {
  throw new PlatformNotImplementedError(platform)
}
