'use client'

import { useTranslations } from 'next-intl'
import { AppShell } from '@/components/AppShell'

export default function ClientsPage() {
  const t = useTranslations('common')

  return (
    <AppShell>
      <div>
        <h1 className="text-2xl font-bold text-gray-900 mb-2">{t('nav.clients')}</h1>
        <p className="text-gray-500 text-sm">Em breve — gerenciamento de clientes.</p>
      </div>
    </AppShell>
  )
}
