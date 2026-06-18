import Fastify from 'fastify'

const app = Fastify({ logger: true })

app.get('/health', async () => {
  return {
    status: 'ok',
    timestamp: new Date().toISOString(),
    version: process.env.npm_package_version ?? '0.0.1',
    env: process.env.NODE_ENV ?? 'development',
  }
})

const start = async () => {
  try {
    await app.listen({ port: 3001, host: '0.0.0.0' })
  } catch (err) {
    app.log.error(err)
    process.exit(1)
  }
}

start()
