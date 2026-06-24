'use client'

import { useTranslations } from 'next-intl'
import { useSearchParams } from 'next/navigation'
import { useEffect, useState } from 'react'
import { AppShell } from '@/components/AppShell'
import { useAuthStore } from '@/stores/auth.store'
import { apiFetch } from '@/lib/api'

const PLATFORMS = ['youtube', 'tiktok', 'instagram'] as const
type Platform = typeof PLATFORMS[number]

const PLATFORM_ICONS: Record<Platform, string> = {
  youtube: '▶',
  tiktok: '♪',
  instagram: '◈',
}

export default function ConnectionsPage() {
  const t = useTranslations('common')
  const searchParams = useSearchParams()
  const { accessToken, workspaceId } = useAuthStore()
  const [connecting, setConnecting] = useState<Platform | null>(null)
  const [successPlatform, setSuccessPlatform] = useState<Platform | null>(null)

  useEffect(() => {
    const connected = searchParams.get('connected') as Platform | null
    if (connected && PLATFORMS.includes(connected)) {
      setSuccessPlatform(connected)
      const timer = setTimeout(() => setSuccessPlatform(null), 4000)
      return () => clearTimeout(timer)
    }
  }, [searchParams])

  async function handleConnect(platform: Platform) {
    if (!accessToken || !workspaceId) return
    setConnecting(platform)
    try {
      const data = await apiFetch<{ authUrl: string }>(
        `/social-auth/${platform}/connect`,
        { token: accessToken, workspaceId },
      )
      window.location.href = data.authUrl
    } catch (err) {
      console.error(err)
    } finally {
      setConnecting(null)
    }
  }

  return (
    <AppShell>
      <h1 className="text-2xl font-bold text-gray-900 mb-6">{t('connections.title')}</h1>

      {successPlatform && (
        <div className="mb-6 bg-green-50 border border-green-200 text-green-700 rounded-xl px-4 py-3 text-sm">
          {t(`connections.${successPlatform}` as Parameters<typeof t>[0])} — {t('connections.connected')}
        </div>
      )}

      <div className="space-y-3">
        {PLATFORMS.map((platform) => (
          <div
            key={platform}
            className="bg-white rounded-xl border border-gray-100 shadow-sm px-6 py-4 flex items-center justify-between"
          >
            <div className="flex items-center gap-4">
              <span className="text-2xl w-8 text-center">{PLATFORM_ICONS[platform]}</span>
              <div>
                <p className="font-medium text-gray-900">
                  {t(`connections.${platform}` as Parameters<typeof t>[0])}
                </p>
                <p className="text-sm text-gray-400">{t('connections.notConnected')}</p>
              </div>
            </div>
            <button
              onClick={() => handleConnect(platform)}
              disabled={connecting === platform}
              className="rounded-lg border border-indigo-200 bg-indigo-50 text-indigo-700 px-4 py-1.5 text-sm font-medium hover:bg-indigo-100 disabled:opacity-50 transition-colors"
            >
              {connecting === platform ? t('common.loading') : t('connections.connect')}
            </button>
          </div>
        ))}
      </div>
    </AppShell>
  )
}
