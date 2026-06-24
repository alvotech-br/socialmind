'use client'

import { useTranslations } from 'next-intl'
import { AppShell } from '@/components/AppShell'

export default function PostsPage() {
  const t = useTranslations('common')

  return (
    <AppShell>
      <div>
        <h1 className="text-2xl font-bold text-gray-900 mb-2">{t('nav.posts')}</h1>
        <p className="text-gray-500 text-sm">Em breve — agendamento e publicação de posts.</p>
      </div>
    </AppShell>
  )
}
