import type { PublishParams, PublishResult } from './index.js'
import { prisma } from '../prisma.js'

const GRAPH_URL = 'https://graph.facebook.com/v19.0'
const META_AUTH_URL = 'https://www.facebook.com/v19.0/dialog/oauth'
const META_TOKEN_URL = `${GRAPH_URL}/oauth/access_token`

const META_SCOPES = [
  'instagram_basic',
  'instagram_content_publish',
  'pages_show_list',
  'pages_read_engagement',
].join(',')

export function getInstagramAuthUrl(state: string): string {
  const params = new URLSearchParams({
    client_id: process.env.META_APP_ID ?? '',
    redirect_uri: process.env.META_REDIRECT_URI ?? '',
    scope: META_SCOPES,
    response_type: 'code',
    state,
  })
  return `${META_AUTH_URL}?${params.toString()}`
}

export async function exchangeInstagramCode(code: string): Promise<{
  accessToken: string
  expiresAt: Date
  igUserId: string
  handle: string
}> {
  // 1. Troca code por short-lived token
  const tokenRes = await fetch(META_TOKEN_URL, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({
      client_id: process.env.META_APP_ID ?? '',
      client_secret: process.env.META_APP_SECRET ?? '',
      redirect_uri: process.env.META_REDIRECT_URI ?? '',
      code,
      grant_type: 'authorization_code',
    }),
  })

  const tokenData = (await tokenRes.json()) as {
    access_token?: string
    error?: { message: string }
  }

  if (!tokenData.access_token) {
    throw new Error(`Meta token error: ${tokenData.error?.message ?? 'unknown'}`)
  }

  // 2. Troca por long-lived token (60 dias)
  const llRes = await fetch(
    `${META_TOKEN_URL}?grant_type=fb_exchange_token&client_id=${process.env.META_APP_ID}&client_secret=${process.env.META_APP_SECRET}&fb_exchange_token=${tokenData.access_token}`,
  )
  const llData = (await llRes.json()) as {
    access_token?: string
    expires_in?: number
    error?: { message: string }
  }

  const longLivedToken = llData.access_token ?? tokenData.access_token
  const expiresIn = llData.expires_in ?? 60 * 24 * 3600 // 60 dias default

  // 3. Busca contas do Facebook para obter conta Instagram Business vinculada
  const accountsRes = await fetch(
    `${GRAPH_URL}/me/accounts?access_token=${longLivedToken}&fields=instagram_business_account{id,username}`,
  )
  const accountsData = (await accountsRes.json()) as {
    data?: Array<{ instagram_business_account?: { id: string; username: string } }>
    error?: { message: string }
  }

  const igAccount = accountsData.data
    ?.map((page) => page.instagram_business_account)
    .find((ig) => ig?.id)

  if (!igAccount?.id) {
    throw new Error('Conta Instagram Business nao encontrada. Vincule a pagina ao Instagram.')
  }

  return {
    accessToken: longLivedToken,
    expiresAt: new Date(Date.now() + expiresIn * 1000),
    igUserId: igAccount.id,
    handle: igAccount.username,
  }
}

export async function publishToInstagram(
  params: PublishParams & { socialAccountId: string },
): Promise<PublishResult> {
  if (!params.videoUrl) {
    throw new Error('Instagram requer URL publica do video (videoUrl)')
  }

  const { accessToken, platformUserId: igUserId, caption, videoUrl } = params

  // 1. Cria container de Reels
  const containerRes = await fetch(`${GRAPH_URL}/${igUserId}/media`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      media_type: 'REELS',
      video_url: videoUrl,
      caption,
      share_to_feed: true,
      access_token: accessToken,
    }),
  })

  const containerData = (await containerRes.json()) as {
    id?: string
    error?: { message: string; code: number }
  }

  if (!containerData.id) {
    throw new Error(
      `Instagram container error: ${containerData.error?.message ?? 'unknown'}`,
    )
  }

  const creationId = containerData.id

  // 2. Verifica status do container antes de publicar
  const statusRes = await fetch(
    `${GRAPH_URL}/${creationId}?fields=status_code,status&access_token=${accessToken}`,
  )
  const statusData = (await statusRes.json()) as {
    status_code?: string
    status?: string
    error?: { message: string }
  }

  // EXPIRED / ERROR / FINISHED / IN_PROGRESS / PUBLISHED
  if (statusData.status_code === 'ERROR') {
    await prisma.socialAccount.update({
      where: { id: params.socialAccountId },
      data: { needsReauth: true },
    })
    throw new Error(`Instagram media error: ${statusData.status ?? 'unknown'}`)
  }

  if (statusData.status_code !== 'FINISHED') {
    // Video ainda sendo processado — BullMQ vai tentar novamente
    throw new Error(
      `Instagram: media ainda sendo processada (status: ${statusData.status_code ?? 'unknown'})`,
    )
  }

  // 3. Publica o container
  const publishRes = await fetch(`${GRAPH_URL}/${igUserId}/media_publish`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      creation_id: creationId,
      access_token: accessToken,
    }),
  })

  const publishData = (await publishRes.json()) as {
    id?: string
    error?: { message: string }
  }

  if (!publishData.id) {
    throw new Error(
      `Instagram publish error: ${publishData.error?.message ?? 'unknown'}`,
    )
  }

  return {
    platformPostId: publishData.id,
    publishedUrl: `https://www.instagram.com/p/${publishData.id}/`,
  }
}
