'use client'

import { useState } from 'react'
import { useTranslations } from 'next-intl'
import Link from 'next/link'
import { useRouter, useParams } from 'next/navigation'
import { useAuthStore } from '@/stores/auth.store'
import { LanguageSwitcher } from '@/components/LanguageSwitcher'

export default function LoginPage() {
  const t = useTranslations()
  const router = useRouter()
  const { locale } = useParams<{ locale: string }>()
  const { login, isLoading } = useAuthStore()

  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [error, setError] = useState('')
  const [needs2FA, setNeeds2FA] = useState(false)
  const [code2FA, setCode2FA] = useState('')

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault()
    setError('')
    try {
      const result = await login(email, password)
      if (result.requires2FA) {
        setNeeds2FA(true)
        return
      }
      router.push(`/${locale}/dashboard`)
    } catch (err) {
      setError(err instanceof Error ? err.message : t('errors.unauthorized'))
    }
  }

  return (
    <div className="min-h-screen bg-gray-50 flex flex-col justify-center">
      <div className="absolute top-4 right-4">
        <LanguageSwitcher />
      </div>

      <div className="mx-auto w-full max-w-sm px-6">
        <div className="text-center mb-8">
          <h1 className="text-3xl font-bold text-gray-900">SocialMind</h1>
          <p className="mt-2 text-gray-500">{t('common.welcome')}</p>
        </div>

        <div className="bg-white rounded-2xl shadow-sm border border-gray-100 p-8">
          {!needs2FA ? (
            <form onSubmit={handleSubmit} className="space-y-4">
              <div>
                <label htmlFor="email" className="block text-sm font-medium text-gray-700 mb-1">
                  {t('auth.email')}
                </label>
                <input
                  id="email"
                  type="email"
                  required
                  value={email}
                  onChange={(e) => setEmail(e.target.value)}
                  className="w-full rounded-lg border border-gray-300 px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-indigo-500 focus:border-transparent"
                  autoComplete="email"
                />
              </div>

              <div>
                <div className="flex justify-between mb-1">
                  <label htmlFor="password" className="block text-sm font-medium text-gray-700">
                    {t('auth.password')}
                  </label>
                  <Link
                    href={`/${locale}/forgot-password`}
                    className="text-xs text-indigo-600 hover:underline"
                  >
                    {t('auth.forgotPassword')}
                  </Link>
                </div>
                <input
                  id="password"
                  type="password"
                  required
                  value={password}
                  onChange={(e) => setPassword(e.target.value)}
                  className="w-full rounded-lg border border-gray-300 px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-indigo-500 focus:border-transparent"
                  autoComplete="current-password"
                />
              </div>

              {error && (
                <p className="text-sm text-red-600 bg-red-50 rounded-lg px-3 py-2">{error}</p>
              )}

              <button
                type="submit"
                disabled={isLoading}
                className="w-full rounded-lg bg-indigo-600 text-white py-2.5 text-sm font-medium hover:bg-indigo-700 focus:outline-none focus:ring-2 focus:ring-indigo-500 focus:ring-offset-2 disabled:opacity-50 disabled:cursor-not-allowed transition-colors"
              >
                {isLoading ? t('common.loading') : t('auth.login')}
              </button>

              <p className="text-center text-sm text-gray-500">
                {t('common.or')}{' '}
                <Link href={`/${locale}/register`} className="text-indigo-600 font-medium hover:underline">
                  {t('auth.register')}
                </Link>
              </p>
            </form>
          ) : (
            <form onSubmit={handleSubmit} className="space-y-4">
              <p className="text-sm text-gray-600 text-center">
                {t('auth.twoFactorCode')}
              </p>
              <input
                type="text"
                inputMode="numeric"
                maxLength={6}
                value={code2FA}
                onChange={(e) => setCode2FA(e.target.value)}
                className="w-full rounded-lg border border-gray-300 px-3 py-2 text-sm text-center tracking-widest focus:outline-none focus:ring-2 focus:ring-indigo-500"
                placeholder="000000"
                autoFocus
              />
              {error && (
                <p className="text-sm text-red-600 bg-red-50 rounded-lg px-3 py-2">{error}</p>
              )}
              <button
                type="submit"
                disabled={isLoading}
                className="w-full rounded-lg bg-indigo-600 text-white py-2.5 text-sm font-medium hover:bg-indigo-700 disabled:opacity-50 transition-colors"
              >
                {isLoading ? t('common.loading') : t('common.confirm')}
              </button>
            </form>
          )}
        </div>
      </div>
    </div>
  )
}
