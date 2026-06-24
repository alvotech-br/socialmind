import type { PublishParams, PublishResult } from './index.js'
import { prisma } from '../prisma.js'

const TIKTOK_AUTH_URL = 'https://www.tiktok.com/v2/auth/authorize/'
const TIKTOK_TOKEN_URL = 'https://open.tiktokapis.com/v2/oauth/token/'
const TIKTOK_USER_URL = 'https://open.tiktokapis.com/v2/user/info/'
const TIKTOK_PUBLISH_URL = 'https://open.tiktokapis.com/v2/post/publish/video/init/'
const TIKTOK_STATUS_URL = 'https://open.tiktokapis.com/v2/post/publish/status/fetch/'

const TIKTOK_SCOPES = 'user.info.basic,video.publish,video.upload'

export function getTiktokAuthUrl(state: string): string {
  const params = new URLSearchParams({
    client_key: process.env.TIKTOK_CLIENT_KEY ?? '',
    redirect_uri: process.env.TIKTOK_REDIRECT_URI ?? '',
    response_type: 'code',
    scope: TIKTOK_SCOPES,
    state,
  })
  return `${TIKTOK_AUTH_URL}?${params.toString()}`
}

export async function exchangeTiktokCode(code: string): Promise<{
  accessToken: string
  refreshToken: string
  expiresAt: Date
  openId: string
  handle: string
}> {
  const res = await fetch(TIKTOK_TOKEN_URL, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({
      client_key: process.env.TIKTOK_CLIENT_KEY ?? '',
      client_secret: process.env.TIKTOK_CLIENT_SECRET ?? '',
      code,
      grant_type: 'authorization_code',
      redirect_uri: process.env.TIKTOK_REDIRECT_URI ?? '',
    }),
  })

  const data = (await res.json()) as {
    data?: {
      access_token: string
      refresh_token: string
      expires_in: number
      open_id: string
    }
    error?: string
    error_description?: string
  }

  if (!res.ok || data.error || !data.data) {
    throw new Error(`TikTok token error: ${data.error_description ?? data.error ?? 'unknown'}`)
  }

  const { access_token, refresh_token, expires_in, open_id } = data.data

  // Busca display_name para usar como handle
  const userRes = await fetch(`${TIKTOK_USER_URL}?fields=open_id,display_name`, {
    headers: { Authorization: `Bearer ${access_token}` },
  })
  const userData = (await userRes.json()) as {
    data?: { user?: { display_name?: string } }
  }
  const handle = userData.data?.user?.display_name ?? open_id

  return {
    accessToken: access_token,
    refreshToken: refresh_token,
    expiresAt: new Date(Date.now() + expires_in * 1000),
    openId: open_id,
    handle,
  }
}

async function refreshTiktokToken(
  refreshToken: string,
  socialAccountId: string,
): Promise<string> {
  const res = await fetch(TIKTOK_TOKEN_URL, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({
      client_key: process.env.TIKTOK_CLIENT_KEY ?? '',
      client_secret: process.env.TIKTOK_CLIENT_SECRET ?? '',
      grant_type: 'refresh_token',
      refresh_token: refreshToken,
    }),
  })

  const data = (await res.json()) as {
    data?: { access_token: string; refresh_token: string; expires_in: number }
    error?: string
  }

  if (!res.ok || !data.data) throw new Error('Falha ao renovar token TikTok')

  await prisma.socialAccount.update({
    where: { id: socialAccountId },
    data: {
      accessToken: data.data.access_token,
      refreshToken: data.data.refresh_token,
      expiresAt: new Date(Date.now() + data.data.expires_in * 1000),
      needsReauth: false,
    },
  })

  return data.data.access_token
}

export async function publishToTiktok(
  params: PublishParams & { socialAccountId: string },
): Promise<PublishResult> {
  if (!params.videoUrl) {
    throw new Error('TikTok requer URL publica do video (videoUrl)')
  }

  let accessToken = params.accessToken

  // Tenta renovar se tiver refresh token disponível
  if (params.refreshToken) {
    try {
      accessToken = await refreshTiktokToken(params.refreshToken, params.socialAccountId)
    } catch {
      // Continua com o token atual — pode ainda ser válido
    }
  }

  const title = params.title ?? params.caption.slice(0, 2200)

  const initRes = await fetch(TIKTOK_PUBLISH_URL, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${accessToken}`,
      'Content-Type': 'application/json; charset=UTF-8',
    },
    body: JSON.stringify({
      post_info: {
        title,
        privacy_level: 'PUBLIC_TO_EVERYONE',
        disable_duet: false,
        disable_comment: false,
        disable_stitch: false,
      },
      source_info: {
        source: 'PULL_FROM_URL',
        video_url: params.videoUrl,
      },
    }),
  })

  const initData = (await initRes.json()) as {
    data?: { publish_id: string }
    error?: { code: string; message: string }
  }

  if (!initRes.ok || !initData.data?.publish_id) {
    throw new Error(
      `TikTok publish error: ${initData.error?.message ?? initData.error?.code ?? 'unknown'}`,
    )
  }

  const publishId = initData.data.publish_id

  // Verifica status (TikTok processa de forma assíncrona)
  const statusRes = await fetch(TIKTOK_STATUS_URL, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${accessToken}`,
      'Content-Type': 'application/json; charset=UTF-8',
    },
    body: JSON.stringify({ publish_id: publishId }),
  })

  const statusData = (await statusRes.json()) as {
    data?: { status: string; publicaly_available_post_id?: string[] }
    error?: { code: string; message: string }
  }

  const status = statusData.data?.status
  // PROCESSING_DOWNLOAD / PROCESSING_UPLOAD / SEND_TO_USER_INBOX / PUBLISH_COMPLETE / FAILED
  if (status === 'FAILED') {
    throw new Error('TikTok: publicacao falhou durante processamento')
  }

  // Se ainda processando, lanca erro para BullMQ fazer retry
  if (status !== 'PUBLISH_COMPLETE') {
    throw new Error(`TikTok: video ainda sendo processado (status: ${status})`)
  }

  const videoId = statusData.data?.publicaly_available_post_id?.[0] ?? publishId

  return {
    platformPostId: publishId,
    publishedUrl: `https://www.tiktok.com/@${params.platformUserId}/video/${videoId}`,
  }
}
