'use client'

import { useLocale, useTranslations } from 'next-intl'
import { useRouter, usePathname } from 'next/navigation'
import { locales, type Locale } from '@social/i18n'

export function LanguageSwitcher() {
  const locale = useLocale()
  const t = useTranslations('common')
  const router = useRouter()
  const pathname = usePathname()

  function switchLocale(newLocale: Locale) {
    // Substitui o segmento de locale na URL atual
    const segments = pathname.split('/')
    segments[1] = newLocale
    router.push(segments.join('/'))
  }

  return (
    <div className="relative inline-block">
      <select
        value={locale}
        onChange={(e) => switchLocale(e.target.value as Locale)}
        className="appearance-none bg-transparent border border-gray-300 rounded-md px-3 py-1.5 text-sm cursor-pointer focus:outline-none focus:ring-2 focus:ring-indigo-500 pr-8"
        aria-label={t('language')}
      >
        {locales.map((l) => (
          <option key={l} value={l}>
            {t(`languages.${l}` as Parameters<typeof t>[0])}
          </option>
        ))}
      </select>
      <span className="pointer-events-none absolute right-2 top-1/2 -translate-y-1/2 text-gray-400 text-xs">
        ▾
      </span>
    </div>
  )
}
