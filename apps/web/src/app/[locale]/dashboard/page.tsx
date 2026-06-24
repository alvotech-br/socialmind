import { useTranslations } from 'next-intl'
import { AppShell } from '@/components/AppShell'

function StatCard({ label, value, color }: { label: string; value: number; color: string }) {
  return (
    <div className="bg-white rounded-xl border border-gray-100 shadow-sm p-6">
      <p className="text-sm text-gray-500">{label}</p>
      <p className={`text-3xl font-bold mt-1 ${color}`}>{value}</p>
    </div>
  )
}

export default function DashboardPage() {
  const t = useTranslations('common')

  return (
    <AppShell>
      <h1 className="text-2xl font-bold text-gray-900 mb-6">{t('dashboard.title')}</h1>

      <div className="grid grid-cols-3 gap-4 mb-8">
        <StatCard label={t('dashboard.scheduledPosts')} value={0} color="text-indigo-600" />
        <StatCard label={t('dashboard.publishedPosts')} value={0} color="text-green-600" />
        <StatCard label={t('dashboard.failedPosts')} value={0} color="text-red-500" />
      </div>

      <div className="bg-white rounded-xl border border-gray-100 shadow-sm p-6">
        <h2 className="text-base font-semibold text-gray-700 mb-4">{t('dashboard.recentActivity')}</h2>
        <p className="text-sm text-gray-400 text-center py-8">—</p>
      </div>
    </AppShell>
  )
}
