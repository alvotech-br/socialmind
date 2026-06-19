import { describe, it, expect } from 'vitest'
import Fastify from 'fastify'

describe('GET /health', () => {
  it('retorna status ok', async () => {
    const app = Fastify()

    app.get('/health', async () => ({
      status: 'ok',
      timestamp: new Date().toISOString(),
      version: '0.0.1',
      env: process.env.NODE_ENV ?? 'development',
    }))

    const response = await app.inject({ method: 'GET', url: '/health' })

    expect(response.statusCode).toBe(200)
    expect(response.json().status).toBe('ok')
  })
})
