import { PrismaClient } from './generated/client'
import bcrypt from 'bcryptjs'

const prisma = new PrismaClient()

const BCRYPT_ROUNDS = 12

async function main() {
  console.log('🌱 Iniciando seed...')

  // ── CENÁRIO 1 — AGENCY (Social Media Manager) ─────────────────────────────

  const agencyEmail = process.env.SEED_USER_EMAIL ?? 'agency@example.com'
  const agencyPassword = process.env.SEED_USER_PASSWORD ?? 'Seed1234!'

  const agencyUser = await prisma.user.upsert({
    where: { email: agencyEmail },
    update: {},
    create: {
      email: agencyEmail,
      passwordHash: await bcrypt.hash(agencyPassword, BCRYPT_ROUNDS),
      name: 'Ana Social Media',
      locale: 'pt-BR',
    },
  })

  const agencyWorkspace = await prisma.workspace.upsert({
    where: { slug: 'agencia-demo' },
    update: {},
    create: {
      ownerId: agencyUser.id,
      name: 'Agência Demo',
      slug: 'agencia-demo',
      accountType: 'AGENCY',
      selfOwned: false,
      planType: 'TRIAL',
      trialEndsAt: new Date(Date.now() + 14 * 24 * 60 * 60 * 1000),
    },
  })

  await prisma.workspaceMember.upsert({
    where: { workspaceId_userId: { workspaceId: agencyWorkspace.id, userId: agencyUser.id } },
    update: {},
    create: {
      workspaceId: agencyWorkspace.id,
      userId: agencyUser.id,
      role: 'OWNER',
    },
  })

  const agencyClients = [
    { name: 'Cliente Alpha', handle: '@alpha' },
    { name: 'Cliente Beta', handle: '@beta' },
    { name: 'Cliente Gamma', handle: '@gamma' },
  ]

  for (const clientData of agencyClients) {
    const client = await prisma.client.create({
      data: {
        workspaceId: agencyWorkspace.id,
        name: clientData.name,
        handle: clientData.handle,
        isSelf: false,
      },
    })

    for (const platform of ['INSTAGRAM', 'TIKTOK', 'YOUTUBE'] as const) {
      await prisma.socialAccount.create({
        data: {
          clientId: client.id,
          platform,
          platformUserId: `${platform.toLowerCase()}_${client.id}`,
          handle: clientData.handle ?? '',
          accessToken: `access_token_${platform.toLowerCase()}_seed`,
          refreshToken: `refresh_token_${platform.toLowerCase()}_seed`,
          expiresAt: new Date(Date.now() + 60 * 24 * 60 * 60 * 1000),
        },
      })
    }
  }

  for (const consent of [
    { type: 'TERMS', version: 'v1.0' },
    { type: 'PRIVACY', version: 'v1.0' },
    { type: 'COOKIES', version: 'v1.0' },
  ] as const) {
    await prisma.consentRecord.create({
      data: {
        userId: agencyUser.id,
        consentType: consent.type,
        version: consent.version,
        locale: 'pt-BR',
        metadata:
          consent.type === 'COOKIES'
            ? { essential: true, analytics: true, performance: true, experience: true }
            : undefined,
      },
    })
  }

  console.log(`  ✓ AGENCY: ${agencyEmail} | workspace: ${agencyWorkspace.slug} | 3 clientes`)

  // ── CENÁRIO 2 — SELF (Influencer) ─────────────────────────────────────────

  const selfEmail = process.env.SEED_USER2_EMAIL ?? 'influencer@example.com'
  const selfPassword = process.env.SEED_USER2_PASSWORD ?? 'Seed1234!'

  const selfUser = await prisma.user.upsert({
    where: { email: selfEmail },
    update: {},
    create: {
      email: selfEmail,
      passwordHash: await bcrypt.hash(selfPassword, BCRYPT_ROUNDS),
      name: 'João Influencer',
      locale: 'en',
    },
  })

  const selfWorkspace = await prisma.workspace.upsert({
    where: { slug: 'joao-influencer' },
    update: {},
    create: {
      ownerId: selfUser.id,
      name: 'João Influencer',
      slug: 'joao-influencer',
      accountType: 'SELF',
      selfOwned: true,
      planType: 'TRIAL',
      trialEndsAt: new Date(Date.now() + 14 * 24 * 60 * 60 * 1000),
    },
  })

  await prisma.workspaceMember.upsert({
    where: { workspaceId_userId: { workspaceId: selfWorkspace.id, userId: selfUser.id } },
    update: {},
    create: {
      workspaceId: selfWorkspace.id,
      userId: selfUser.id,
      role: 'OWNER',
    },
  })

  const selfClient = await prisma.client.create({
    data: {
      workspaceId: selfWorkspace.id,
      name: selfUser.name,
      handle: '@joaoinfluencer',
      isSelf: true,
    },
  })

  for (const platform of ['INSTAGRAM', 'TIKTOK', 'YOUTUBE'] as const) {
    await prisma.socialAccount.create({
      data: {
        clientId: selfClient.id,
        platform,
        platformUserId: `${platform.toLowerCase()}_${selfClient.id}`,
        handle: '@joaoinfluencer',
        accessToken: `access_token_${platform.toLowerCase()}_seed`,
        refreshToken: `refresh_token_${platform.toLowerCase()}_seed`,
        expiresAt: new Date(Date.now() + 60 * 24 * 60 * 60 * 1000),
      },
    })
  }

  for (const consent of [
    { type: 'TERMS', version: 'v1.0' },
    { type: 'PRIVACY', version: 'v1.0' },
    { type: 'COOKIES', version: 'v1.0' },
  ] as const) {
    await prisma.consentRecord.create({
      data: {
        userId: selfUser.id,
        consentType: consent.type,
        version: consent.version,
        locale: 'en',
        metadata:
          consent.type === 'COOKIES'
            ? { essential: true, analytics: true, performance: true, experience: true }
            : undefined,
      },
    })
  }

  console.log(`  ✓ SELF: ${selfEmail} | workspace: ${selfWorkspace.slug} | 1 client isSelf`)
  console.log('✅ Seed concluído!')
}

main()
  .catch((e) => {
    console.error('❌ Erro no seed:', e)
    process.exit(1)
  })
  .finally(async () => {
    await prisma.$disconnect()
  })
