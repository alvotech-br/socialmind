import Fastify from 'fastify'
import cors from '@fastify/cors'
import helmet from '@fastify/helmet'
import jwt from '@fastify/jwt'
import rateLimit from '@fastify/rate-limit'
import cookie from '@fastify/cookie'
import i18nPlugin from './plugins/i18n.js'
import authPlugin from './plugins/auth.js'
import workspaceContextPlugin from './plugins/workspace-context.js'
import { authRoutes } from './routes/auth.js'
import { privacyRoutes } from './routes/privacy.js'
import { clientRoutes } from './routes/clients.js'
import { workspaceRoutes } from './routes/workspaces.js'

const SENSITIVE_FIELDS = ['password', 'passwordHash', 'accessToken', 'refreshToken', 'twoFaSecret']

export const buildApp = async () => {
  const app = Fastify({
    logger: {
      level: process.env.NODE_ENV === 'test' ? 'silent' : 'info',
      redact: SENSITIVE_FIELDS,
    },
  })

  await app.register(cors, { origin: process.env.APP_URL ?? true, credentials: true })
  await app.register(helmet)
  await app.register(cookie)
  await app.register(rateLimit, { max: 100, timeWindow: '1 minute' })
  await app.register(jwt, {
    secret: process.env.JWT_SECRET ?? 'dev-secret-change-in-production',
  })
  await app.register(i18nPlugin)
  await app.register(authPlugin)
  await app.register(workspaceContextPlugin)
  await app.register(authRoutes, { prefix: '/auth' })
  await app.register(privacyRoutes, { prefix: '/privacy' })
  await app.register(workspaceRoutes, { prefix: '/workspaces' })
  await app.register(clientRoutes, { prefix: '/workspaces/:workspaceId/clients' })

  app.get('/health', async () => ({
    status: 'ok',
    timestamp: new Date().toISOString(),
    version: process.env.npm_package_version ?? '0.0.1',
    env: process.env.NODE_ENV ?? 'development',
  }))

  return app
}

if (process.env.NODE_ENV !== 'test') {
  buildApp().then((app) =>
    app.listen({ port: Number(process.env.PORT ?? 3001), host: '0.0.0.0' })
  ).catch((err) => {
    console.error(err)
    process.exit(1)
  })
}
