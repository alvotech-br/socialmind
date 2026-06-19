import { describe, it, expect, vi } from 'vitest'
import { buildApp } from '../server.js'

vi.mock('../lib/prisma.js', () => ({
  prisma: {
    consentRecord: {
      create: vi.fn().mockResolvedValue({ id: 'consent-id-1' }),
      updateMany: vi.fn().mockResolvedValue({ count: 1 }),
    },
  },
}))

describe('POST /privacy/consents/cookies', () => {
  it('grava sem autenticacao', async () => {
    const app = await buildApp()
    const res = await app.inject({
      method: 'POST',
      url: '/privacy/consents/cookies',
      payload: { accepted: true, sessionId: 'session-abc', version: 'v1.0' },
    })
    expect(res.statusCode).toBe(201)
    const body = res.json()
    expect(body.recorded).toBe(true)
    expect(body.consentId).toBe('consent-id-1')
  })

  it('retorna erro se accepted nao for true', async () => {
    const app = await buildApp()
    const res = await app.inject({
      method: 'POST',
      url: '/privacy/consents/cookies',
      payload: { accepted: false, sessionId: 'session-abc', version: 'v1.0' },
    })
    expect(res.statusCode).toBe(400)
  })

  it('retorna erro se sessionId estiver ausente', async () => {
    const app = await buildApp()
    const res = await app.inject({
      method: 'POST',
      url: '/privacy/consents/cookies',
      payload: { accepted: true, version: 'v1.0' },
    })
    expect(res.statusCode).toBe(400)
  })
})

describe('POST /privacy/consents/cookies/link-user', () => {
  it('vinculo de sessionId ao userId funciona com token valido', async () => {
    const app = await buildApp()
    const token = app.jwt.sign({ id: 'user-id-1' })

    const res = await app.inject({
      method: 'POST',
      url: '/privacy/consents/cookies/link-user',
      headers: { authorization: `Bearer ${token}` },
      payload: { sessionId: 'session-abc' },
    })
    expect(res.statusCode).toBe(200)
    expect(res.json().linked).toBe(true)
  })

  it('retorna 401 sem autenticacao', async () => {
    const app = await buildApp()
    const res = await app.inject({
      method: 'POST',
      url: '/privacy/consents/cookies/link-user',
      payload: { sessionId: 'session-abc' },
    })
    expect(res.statusCode).toBe(401)
  })
})
