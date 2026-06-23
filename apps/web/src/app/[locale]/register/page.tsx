'use client'

import { useState } from 'react'
import { useTranslations } from 'next-intl'
import Link from 'next/link'
import { useRouter, useParams } from 'next/navigation'
import { apiFetch } from '@/lib/api'
import { LanguageSwitcher } from '@/components/LanguageSwitcher'

type Step = 1 | 2 | 3

export default function RegisterPage() {
  const t = useTranslations()
  const router = useRouter()
  const { locale } = useParams<{ locale: string }>()

  const [step, setStep] = useState<Step>(1)
  const [isLoading, setIsLoading] = useState(false)
  const [error, setError] = useState('')
  const [sessionToken, setSessionToken] = useState('')

  // Step 1 — dados básicos + LGPD
  const [name, setName] = useState('')
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [acceptedTerms, setAcceptedTerms] = useState(false)
  const [acceptedPrivacy, setAcceptedPrivacy] = useState(false)

  // Step 2 — tipo de conta
  const [accountType, setAccountType] = useState<'AGENCY' | 'SELF'>('SELF')

  function clearError() {
    if (error) setError('')
  }

  // Step 1: cria usuário + registra consentimentos LGPD
  async function handleStep1(e: React.FormEvent) {
    e.preventDefault()
    setError('')
    setIsLoading(true)
    try {
      const data = await apiFetch<{ sessionToken: string }>('/auth/register/step1', {
        method: 'POST',
        body: JSON.stringify({ name, email, password, acceptedTerms, acceptedPrivacy, locale }),
      })
      setSessionToken(data.sessionToken)
      setStep(2)
    } catch (err) {
      setError(err instanceof Error ? err.message : t('errors.unauthorized'))
    } finally {
      setIsLoading(false)
    }
  }

  // Step 2: define tipo de conta — requer sessionToken do step1
  async function handleStep2(e: React.FormEvent) {
    e.preventDefault()
    setError('')
    setIsLoading(true)
    try {
      const data = await apiFetch<{ sessionToken: string }>('/auth/register/step2', {
        method: 'POST',
        token: sessionToken,
        body: JSON.stringify({ accountType }),
      })
      setSessionToken(data.sessionToken)
      setStep(3)
    } catch (err) {
      setError(err instanceof Error ? err.message : t('errors.unauthorized'))
    } finally {
      setIsLoading(false)
    }
  }

  // Step 3: confirmação final — requer sessionToken do step2
  async function handleStep3(e: React.FormEvent) {
    e.preventDefault()
    setError('')
    setIsLoading(true)
    try {
      await apiFetch('/auth/register/step3', {
        method: 'POST',
        token: sessionToken,
        body: JSON.stringify({}),
      })
      router.push(`/${locale}/login`)
    } catch (err) {
      setError(err instanceof Error ? err.message : t('errors.unauthorized'))
    } finally {
      setIsLoading(false)
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
          <div className="flex justify-center gap-2 mt-4">
            {([1, 2, 3] as Step[]).map((s) => (
              <div
                key={s}
                className={`h-1.5 w-8 rounded-full transition-colors ${s <= step ? 'bg-indigo-600' : 'bg-gray-200'}`}
              />
            ))}
          </div>
        </div>

        <div className="bg-white rounded-2xl shadow-sm border border-gray-100 p-8">

          {/* ── Step 1: dados básicos + consentimentos LGPD ── */}
          {step === 1 && (
            <form onSubmit={handleStep1} className="space-y-4">
              <h2 className="text-lg font-semibold text-gray-900">{t('auth.register')}</h2>

              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">{t('auth.name')}</label>
                <input
                  type="text"
                  required
                  value={name}
                  onChange={(e) => { setName(e.target.value); clearError() }}
                  className="w-full rounded-lg border border-gray-300 px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-indigo-500"
                />
              </div>

              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">{t('auth.email')}</label>
                <input
                  type="email"
                  required
                  value={email}
                  onChange={(e) => { setEmail(e.target.value); clearError() }}
                  className="w-full rounded-lg border border-gray-300 px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-indigo-500"
                />
              </div>

              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">{t('auth.password')}</label>
                <input
                  type="password"
                  required
                  minLength={8}
                  value={password}
                  onChange={(e) => { setPassword(e.target.value); clearError() }}
                  className="w-full rounded-lg border border-gray-300 px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-indigo-500"
                />
              </div>

              <div className="space-y-2 pt-1">
                <label className="flex items-start gap-3 cursor-pointer">
                  <input
                    type="checkbox"
                    checked={acceptedTerms}
                    onChange={(e) => { setAcceptedTerms(e.target.checked); clearError() }}
                    className="mt-0.5 h-4 w-4 rounded border-gray-300 text-indigo-600 focus:ring-indigo-500"
                    required
                  />
                  <span className="text-sm text-gray-700">{t('auth.acceptTerms')}</span>
                </label>

                <label className="flex items-start gap-3 cursor-pointer">
                  <input
                    type="checkbox"
                    checked={acceptedPrivacy}
                    onChange={(e) => { setAcceptedPrivacy(e.target.checked); clearError() }}
                    className="mt-0.5 h-4 w-4 rounded border-gray-300 text-indigo-600 focus:ring-indigo-500"
                    required
                  />
                  <span className="text-sm text-gray-700">{t('auth.acceptPrivacy')}</span>
                </label>
              </div>

              {error && <p className="text-sm text-red-600 bg-red-50 rounded-lg px-3 py-2">{error}</p>}

              <button
                type="submit"
                disabled={isLoading || !acceptedTerms || !acceptedPrivacy}
                className="w-full rounded-lg bg-indigo-600 text-white py-2.5 text-sm font-medium hover:bg-indigo-700 disabled:opacity-50 transition-colors"
              >
                {isLoading ? t('common.loading') : t('common.next')}
              </button>

              <p className="text-center text-sm text-gray-500">
                {t('common.or')}{' '}
                <Link href={`/${locale}/login`} className="text-indigo-600 font-medium hover:underline">
                  {t('auth.login')}
                </Link>
              </p>
            </form>
          )}

          {/* ── Step 2: tipo de conta ── */}
          {step === 2 && (
            <form onSubmit={handleStep2} className="space-y-4">
              <h2 className="text-lg font-semibold text-gray-900">{t('auth.accountType')}</h2>

              <div className="grid grid-cols-2 gap-2">
                {(['SELF', 'AGENCY'] as const).map((type) => (
                  <button
                    key={type}
                    type="button"
                    onClick={() => setAccountType(type)}
                    className={`rounded-lg border px-3 py-2.5 text-sm font-medium transition-colors ${
                      accountType === type
                        ? 'border-indigo-600 bg-indigo-50 text-indigo-700'
                        : 'border-gray-200 text-gray-600 hover:border-gray-300'
                    }`}
                  >
                    {t(`auth.${type.toLowerCase()}` as Parameters<ReturnType<typeof useTranslations>>[0])}
                  </button>
                ))}
              </div>

              {error && <p className="text-sm text-red-600 bg-red-50 rounded-lg px-3 py-2">{error}</p>}

              <button
                type="submit"
                disabled={isLoading}
                className="w-full rounded-lg bg-indigo-600 text-white py-2.5 text-sm font-medium hover:bg-indigo-700 disabled:opacity-50 transition-colors"
              >
                {isLoading ? t('common.loading') : t('common.next')}
              </button>
            </form>
          )}

          {/* ── Step 3: confirmação ── */}
          {step === 3 && (
            <form onSubmit={handleStep3} className="space-y-4 text-center">
              <div className="text-4xl">✉️</div>
              <h2 className="text-lg font-semibold text-gray-900">{t('auth.register')}</h2>
              <p className="text-sm text-gray-500">{email}</p>

              {error && <p className="text-sm text-red-600 bg-red-50 rounded-lg px-3 py-2">{error}</p>}

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
