import { describe, it, expect, vi, beforeEach } from 'vitest'
import { buildApp } from '../server.js'

const WS_UUID = 'cc000000-0000-0000-0000-000000000001'

const prismaMock = vi.hoisted(() => ({
  workspaceMember: { findFirst: vi.fn(), findUnique: vi.fn(), findMany: vi.fn(), create: vi.fn(), update: vi.fn(), delete: vi.fn() },
  client:          { findFirst: vi.fn(), findMany: vi.fn(), create: vi.fn(), update: vi.fn() },
  workspace:       { findUnique: vi.fn(), findUniqueOrThrow: vi.fn(), create: vi.fn(), update: vi.fn(), findFirst: vi.fn() },
  user:            { findUnique: vi.fn(), findUniqueOrThrow: vi.fn() },
  socialAccount:   { findFirst: vi.fn(), upsert: vi.fn() },
  mediaFile:       { findFirst: vi.fn(), create: vi.fn(), findMany: vi.fn(), update: vi.fn() },
  post:            { create: vi.fn(), findMany: vi.fn(), findFirst: vi.fn(), update: vi.fn(), count: vi.fn() },
  auditLog:        { create: vi.fn() },
  consentRecord:   { create: vi.fn(), updateMany: vi.fn(), createMany: vi.fn() },
  refreshToken:    { create: vi.fn(), findUnique: vi.fn(), updateMany: vi.fn() },
  passwordResetToken: { findUnique: vi.fn() },
  dataDeletionRequest: { findFirst: vi.fn() },
  $transaction:    vi.fn(),
}))

vi.mock('../lib/prisma.js', () => ({ prisma: prismaMock }))
vi.mock('../lib/queue.js', () => ({
  thumbnailQueue: { add: vi.fn() },
  publicationQueue: { add: vi.fn() },
}))
vi.mock('../lib/publishers/youtube.js', () => ({ getYoutubeAuthUrl: vi.fn(), exchangeYoutubeCode: vi.fn() }))
vi.mock('../lib/publishers/tiktok.js', () => ({ getTiktokAuthUrl: vi.fn(), exchangeTiktokCode: vi.fn() }))
vi.mock('../lib/publishers/instagram.js', () => ({ getInstagramAuthUrl: vi.fn(), exchangeInstagramCode: vi.fn() }))

const stripeMock = vi.hoisted(() => ({
  customers: { create: vi.fn() },
  checkout: { sessions: { create: vi.fn() } },
  billingPortal: { sessions: { create: vi.fn() } },
  subscriptions: { retrieve: vi.fn() },
  webhooks: { constructEvent: vi.fn() },
}))

vi.mock('../lib/stripe.js', () => ({
  stripe: stripeMock,
  PRICE_IDS: { STARTER: 'price_starter', PRO: 'price_pro', AGENCY: 'price_agency' },
  PLAN_POST_LIMITS: { TRIAL: 10, STARTER: 100, PRO: 500, AGENCY: 2000 },
}))

const ownerMember = { role: 'OWNER', workspace: { accountType: 'AGENCY', deletedAt: null } }

beforeEach(() => {
  vi.clearAllMocks()
  prismaMock.auditLog.create.mockResolvedValue({})
  prismaMock.workspace.update.mockResolvedValue({})
})

describe('POST /billing/checkout', () => {
  it('cria sessao de checkout e retorna URL', async () => {
    prismaMock.workspaceMember.findFirst.mockResolvedValue(ownerMember)
    prismaMock.workspace.findUnique.mockResolvedValue({
      id: WS_UUID, name: 'Acme', stripeCustomerId: 'cus_existing',
    })
    stripeMock.checkout.sessions.create.mockResolvedValue({ url: 'https://checkout.stripe.com/pay/xxx' })

    const app = await buildApp()
    const token = app.jwt.sign({ id: 'user-1' })

    const res = await app.inject({
      method: 'POST',
      url: '/billing/checkout',
      headers: { authorization: `Bearer ${token}`, 'x-workspace-id': WS_UUID },
      payload: { plan: 'PRO' },
    })

    expect(res.statusCode).toBe(200)
    expect(res.json().url).toContain('stripe.com')
  })

  it('cria customer no Stripe se nao existir', async () => {
    prismaMock.workspaceMember.findFirst.mockResolvedValue(ownerMember)
    prismaMock.workspace.findUnique.mockResolvedValue({
      id: WS_UUID, name: 'Acme', stripeCustomerId: null,
    })
    prismaMock.user.findUnique.mockResolvedValue({ email: 'owner@example.com' })
    stripeMock.customers.create.mockResolvedValue({ id: 'cus_new' })
    stripeMock.checkout.sessions.create.mockResolvedValue({ url: 'https://checkout.stripe.com/pay/yyy' })

    const app = await buildApp()
    const token = app.jwt.sign({ id: 'user-1' })

    const res = await app.inject({
      method: 'POST',
      url: '/billing/checkout',
      headers: { authorization: `Bearer ${token}`, 'x-workspace-id': WS_UUID },
      payload: { plan: 'STARTER' },
    })

    expect(res.statusCode).toBe(200)
    expect(stripeMock.customers.create).toHaveBeenCalled()
  })

  it('retorna 400 para plano invalido', async () => {
    prismaMock.workspaceMember.findFirst.mockResolvedValue(ownerMember)

    const app = await buildApp()
    const token = app.jwt.sign({ id: 'user-1' })

    const res = await app.inject({
      method: 'POST',
      url: '/billing/checkout',
      headers: { authorization: `Bearer ${token}`, 'x-workspace-id': WS_UUID },
      payload: { plan: 'INVALID' },
    })

    expect(res.statusCode).toBe(400)
  })
})

describe('GET /billing/status', () => {
  it('retorna plano e status da assinatura', async () => {
    prismaMock.workspaceMember.findFirst.mockResolvedValue(ownerMember)
    prismaMock.workspace.findUnique.mockResolvedValue({
      planType: 'PRO',
      trialEndsAt: null,
      stripeSubscriptionId: 'sub_123',
      postsThisMonth: 42,
    })
    stripeMock.subscriptions.retrieve.mockResolvedValue({ status: 'active' })

    const app = await buildApp()
    const token = app.jwt.sign({ id: 'user-1' })

    const res = await app.inject({
      method: 'GET',
      url: '/billing/status',
      headers: { authorization: `Bearer ${token}`, 'x-workspace-id': WS_UUID },
    })

    expect(res.statusCode).toBe(200)
    expect(res.json().plan).toBe('PRO')
    expect(res.json().subscriptionStatus).toBe('active')
    expect(res.json().postsThisMonth).toBe(42)
  })
})

describe('POST /billing/portal', () => {
  it('retorna URL do portal de billing', async () => {
    prismaMock.workspaceMember.findFirst.mockResolvedValue(ownerMember)
    prismaMock.workspace.findUnique.mockResolvedValue({
      id: WS_UUID, stripeCustomerId: 'cus_abc',
    })
    stripeMock.billingPortal.sessions.create.mockResolvedValue({
      url: 'https://billing.stripe.com/session/xxx',
    })

    const app = await buildApp()
    const token = app.jwt.sign({ id: 'user-1' })

    const res = await app.inject({
      method: 'POST',
      url: '/billing/portal',
      headers: { authorization: `Bearer ${token}`, 'x-workspace-id': WS_UUID },
    })

    expect(res.statusCode).toBe(200)
    expect(res.json().url).toContain('billing.stripe.com')
  })

  it('retorna 400 se workspace nao tem assinatura', async () => {
    prismaMock.workspaceMember.findFirst.mockResolvedValue(ownerMember)
    prismaMock.workspace.findUnique.mockResolvedValue({
      id: WS_UUID, stripeCustomerId: null,
    })

    const app = await buildApp()
    const token = app.jwt.sign({ id: 'user-1' })

    const res = await app.inject({
      method: 'POST',
      url: '/billing/portal',
      headers: { authorization: `Bearer ${token}`, 'x-workspace-id': WS_UUID },
    })

    expect(res.statusCode).toBe(400)
    expect(res.json().error).toBe('NO_SUBSCRIPTION')
  })
})
