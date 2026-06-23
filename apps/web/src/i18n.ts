import { getRequestConfig } from 'next-intl/server'
import { locales, type Locale } from '@social/i18n'
import { allMessages } from '@social/i18n/loader'

export default getRequestConfig(async ({ locale }) => {
  const safeLocale: Locale = locales.includes(locale as Locale) ? (locale as Locale) : 'pt-BR'

  return {
    locale: safeLocale,
    messages: allMessages[safeLocale],
  }
})
