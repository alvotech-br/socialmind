import fp from 'fastify-plugin'
import type { FastifyPluginAsync, FastifyRequest } from 'fastify'
import i18next, { TFunction } from 'i18next'
import FsBackend from 'i18next-fs-backend'
import { localesDir, defaultLocale, locales, namespaces } from '@social/i18n'

declare module 'fastify' {
  interface FastifyInstance {
    t: TFunction
  }
  interface FastifyRequest {
    t: TFunction
    locale: string
  }
}

const i18nPlugin: FastifyPluginAsync = async (fastify) => {
  await i18next.use(FsBackend).init({
    lng: defaultLocale,
    fallbackLng: defaultLocale,
    supportedLngs: [...locales],
    ns: [...namespaces],
    defaultNS: 'common',
    backend: {
      loadPath: `${localesDir}/{{lng}}/{{ns}}.json`,
    },
    interpolation: { escapeValue: false },
    initImmediate: false,
  })

  fastify.decorate('t', i18next.t.bind(i18next))

  fastify.addHook('preHandler', async (request: FastifyRequest) => {
    const user = request.user as { locale?: string } | undefined

    const locale =
      user?.locale ??
      parseAcceptLanguage(request.headers['accept-language']) ??
      defaultLocale

    const lng = locales.includes(locale as typeof locales[number]) ? locale : defaultLocale

    request.locale = lng
    request.t = i18next.getFixedT(lng)
  })
}

function parseAcceptLanguage(header: string | undefined): string | null {
  if (!header) return null

  const candidates = header
    .split(',')
    .map((part) => {
      const [lang, q] = part.trim().split(';q=')
      return { lang: lang.trim(), q: q ? parseFloat(q) : 1 }
    })
    .sort((a, b) => b.q - a.q)

  for (const { lang } of candidates) {
    if (locales.includes(lang as typeof locales[number])) return lang
    const base = lang.split('-')[0]
    const match = locales.find((l) => l.startsWith(base))
    if (match) return match
  }

  return null
}

export default fp(i18nPlugin, { name: 'i18n' })
