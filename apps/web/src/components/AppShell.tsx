'use client'

import { useEffect } from 'react'
import { useTranslations } from 'next-intl'
import { useRouter, usePathname, useParams } from 'next/navigation'
import Link from 'next/link'
import { useAuthStore } from '@/stores/auth.store'
import { LanguageSwitcher } from '@/components/LanguageSwitcher'

const NAV_ITEMS = [
  { key: 'dashboard', href: 'dashboard', icon: '▦' },
  { key: 'posts', href: 'posts', icon: '📋' },
  { key: 'connections', href: 'connections', icon: '🔗' },
  { key: 'clients', href: 'clients', icon: '👥' },
] as const

export function AppShell({ children }: { children: React.ReactNode }) {
  const t = useTranslations('common')
  const { user, accessToken, refresh, logout } = useAuthStore()
  const router = useRouter()
  const pathname = usePathname()
  const { locale } = useParams<{ locale: string }>()

  useEffect(() => {
    if (!accessToken) {
      refresh().then((ok) => {
        if (!ok) router.push(`/${locale}/login`)
      })
    }
  }, [accessToken, refresh, router, locale])

  async function handleLogout() {
    await logout()
    router.push(`/${locale}/login`)
  }

  if (!accessToken && !user) {
    return (
      <div className="min-h-screen flex items-center justify-center">
        <p className="text-gray-500">{t('loading')}</p>
      </div>
    )
  }

  return (
    <div className="min-h-screen bg-gray-50 flex">
      {/* Sidebar */}
      <aside className="w-56 bg-white border-r border-gray-100 flex flex-col">
        <div className="px-6 py-5 border-b border-gray-100">
          <span className="text-lg font-bold text-indigo-600">SocialMind</span>
        </div>

        <nav className="flex-1 px-3 py-4 space-y-1">
          {NAV_ITEMS.map(({ key, href, icon }) => {
            const isActive = pathname.includes(href)
            return (
              <Link
                key={key}
                href={`/${locale}/${href}`}
                className={`flex items-center gap-3 px-3 py-2 rounded-lg text-sm font-medium transition-colors ${
                  isActive
                    ? 'bg-indigo-50 text-indigo-700'
                    : 'text-gray-600 hover:bg-gray-50 hover:text-gray-900'
                }`}
              >
                <span>{icon}</span>
                {t(`nav.${key}` as Parameters<typeof t>[0])}
              </Link>
            )
          })}
        </nav>

        <div className="px-3 py-4 border-t border-gray-100 space-y-3">
          <LanguageSwitcher />
          <div className="flex items-center justify-between px-1">
            <span className="text-xs text-gray-500 truncate max-w-[100px]">
              {user?.name ?? user?.email}
            </span>
            <button
              onClick={handleLogout}
              className="text-xs text-gray-400 hover:text-red-500 transition-colors"
            >
              {t('nav' as Parameters<typeof t>[0])}
            </button>
          </div>
        </div>
      </aside>

      {/* Main content */}
      <main className="flex-1 overflow-auto">
        <div className="max-w-5xl mx-auto px-8 py-8">
          {children}
        </div>
      </main>
    </div>
  )
}
