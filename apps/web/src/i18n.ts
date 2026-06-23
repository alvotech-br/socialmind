import { getRequestConfig } from 'next-intl/server'
import { locales, type Locale } from '@social/i18n'
import { allMessages } from '@social/i18n/loader'

export default getRequestConfig(async ({ requestLocale }) => {
  const requested = await requestLocale
  const safeLocale: Locale = locales.includes(requested as Locale) ? (requested as Locale) : 'pt-BR'

  return {
    locale: safeLocale,
    messages: allMessages[safeLocale],
  }
})
