# Social Media Platform — Briefing do projeto

## O que e este projeto
Plataforma SaaS de gestao de redes sociais que permite publicar
e agendar posts em Instagram, TikTok e YouTube, gerenciar multiplos
clientes por acesso e acompanhar metricas de desempenho.

## Personas
- Social Media / Gestor (AGENCY): gerencia N clientes, cada um com
  suas proprias redes sociais
- Influencer / Negocio local (SELF): e o proprio cliente, gerencia
  suas proprias redes sociais

## Stack definida

Backend:
- Node.js + TypeScript + Fastify
- ORM: Prisma
- Banco: PostgreSQL
- Fila de jobs: BullMQ + Redis
- Armazenamento: S3 (MinIO em local)
- Auth: JWT + OAuth2
- Testes: Vitest + @fastify/inject
- CI/CD: GitHub Actions

Frontend:
- Next.js 14 (App Router) + TypeScript
- Tailwind CSS
- shadcn/ui
- Zustand
- TanStack Query
- React Hook Form + Zod

i18n:
- Idiomas: pt-BR (padrao), es, en
- Backend: i18next (deteccao via Accept-Language + User.locale)
- Frontend: next-intl
- Arquivos: packages/i18n/locales/{pt-BR,es,en}/

Infra:
- Docker Compose (local)
- Railway ou Render (HML e PROD)

## Ambientes

local
  Finalidade: desenvolvimento
  Banco: PostgreSQL via Docker
  Stripe: nao configurado
  E-mails: console.log
  MinIO: Docker local
  Branch: qualquer feature branch

hml (homologacao)
  Finalidade: validacao e testes antes de ir para producao
  Banco: PostgreSQL dedicado (nao compartilhado com PROD)
  Stripe: test mode (chaves sk_test_...)
  E-mails: servico real mas dominio de teste
  Storage: S3 bucket separado
  Branch: develop
  Deploy: automatico no push para develop
  Migrations: automaticas no deploy

prod (producao)
  Finalidade: usuarios reais
  Banco: PostgreSQL dedicado com backups diarios
  Stripe: live mode (chaves sk_live_...)
  E-mails: servico real com dominio de producao
  Storage: S3 bucket de producao
  Branch: main
  Deploy: manual com aprovacao obrigatoria
  Migrations: NUNCA automaticas — execucao manual apos aprovacao

## Branch strategy
  feature/nome-da-feature  -> pull request -> develop
  develop                  -> deploy automatico -> HML
  main                     -> deploy manual (aprovacao) -> PROD
  hotfix/nome-do-fix       -> pull request -> main (emergencias)

## Regras de negocio criticas
- Multi-tenancy: cada workspace e um tenant isolado
- LGPD e prioridade maxima: toda feature que toca dados precisa de auditoria
- Nenhuma rota criada sem autenticacao validada
- SocialAccount sempre vinculada ao Client, nunca ao Workspace
- NUNCA hardcode de mensagens de erro — sempre usar t('chave')
- Migrations em PROD exigem aprovacao manual antes de executar
- Secrets NUNCA compartilhados entre ambientes

## i18n — regras
- NUNCA escrever mensagens em hardcode no codigo
- Separador de namespace e ":" (nao ".")
  CORRETO:   t('errors:unauthorized')
  ERRADO:    t('errors.unauthorized')
- E-mails e notificacoes tambem usam chaves traduzidas
- Idioma padrao: pt-BR
- Idioma do usuario: salvo em User.locale
- Idioma da requisicao: detectado via Accept-Language
- Hook i18n registrado em onRequest (nao preHandler) para que
  request.t esteja disponivel antes do hook de autenticacao

## Estrutura de pastas
apps/api           -> backend Fastify
apps/web           -> Next.js 14 App Router
packages/db        -> schema Prisma + migrations
packages/shared    -> tipos TypeScript compartilhados
packages/i18n      -> arquivos de traducao compartilhados
infra/             -> docker, variaveis de ambiente
.github/workflows/ -> pipelines CI/CD

## Estrutura do backend (apps/api/src)
plugins/
  i18n.ts              -> i18next, hook onRequest, injeta request.t e request.locale
  auth.ts              -> decora fastify.authenticate (jwtVerify)
  workspace-context.ts -> decora fastify.requireWorkspace
                          resolve workspace por X-Workspace-Id ou subdominio
                          injeta request.workspaceId, userRole, accountType, clientId
lib/
  prisma.ts            -> singleton PrismaClient
  tokens.ts            -> generateSecureToken(), hashToken()
routes/
  auth.ts              -> /auth/register/step1-2-3, /login, /2fa/*, /refresh, /logout,
                          /forgot-password, /reset-password
  privacy.ts           -> /privacy/consents/cookies, /my-data, /delete-account, /consents
  clients.ts           -> /workspaces/:id/clients (CRUD)
  workspaces.ts        -> /workspaces (CRUD) + /workspaces/:id/members (CRUD)
jobs/
  data-deletion.job.ts -> runDataDeletionJob() anonimiza usuarios apos 30 dias

## Modelo de dados central
User (locale: pt-BR | es | en)
  -> WorkspaceMember -> Workspace (accountType: AGENCY | SELF)
                            -> Client (isSelf: boolean)
                                  -> SocialAccount (INSTAGRAM | TIKTOK | YOUTUBE)

Modelos LGPD: AuditLog, ConsentRecord, DataDeletionRequest
Modelos Auth: PasswordResetToken, RefreshToken

## Decisoes tecnicas importantes
- bcrypt rounds: 12
- JWT access token: 15 min
- Refresh token: 7 dias, armazenado como hash SHA-256, rotacionado a cada uso
- 2FA: otplib (TOTP) + 8 backup codes
- Prisma output: packages/db/generated/client (no .gitignore)
  -> CI precisa rodar "pnpm --filter db generate" antes de typecheck/test/build
- Testes usam vi.hoisted() para mocks do Prisma (nao vi.mock direto com variaveis)
- workspaceId e clientId NUNCA vem do body — sempre do header ou resolvidos internamente
- my-data usa select explicito para nunca expor passwordHash, twoFaSecret, tokens
- IDs nos testes devem ser UUIDs validos (somente hex: 0-9, a-f) — ex: 'aa000000-0000-0000-0000-000000000001'
  Prefixos como 'ws-', 'sa-', 'po-' contem letras invalidas e falham no z.string().uuid()
- State CSRF do OAuth (YouTube/TikTok/Instagram) armazenado em Map em memoria com TTL 10min
  Suficiente para single-instance. Se escalar para multi-instance: mover para Redis
  Arquivo: apps/api/src/routes/social-auth.ts (pendingStates)

## Estado atual do projeto — Sprint 1 CONCLUIDO

Todos os 3 blocos implementados, testados localmente e com PR aberto para develop.

Bloco 1 (feature/setup-base) — MERGEADO em develop e main
  Scaffolding monorepo pnpm, i18n, Docker Compose, schema Prisma,
  migration init, seed (AGENCY + SELF), CI/CD GitHub Actions

Bloco 2 (feature/auth-onboarding) — MERGEADO em develop
  Registro 3 fases (LGPD), login, 2FA, refresh/logout,
  reset de senha, cookie consent. 28 testes.

Bloco 3 (feature/multi-tenancy-lgpd) — PR ABERTO para develop
  Middleware workspace-context, CRUD clientes, CRUD workspaces/membros,
  rotas LGPD (my-data, delete-account, consents),
  job de anonimizacao LGPD Art.18. 43 testes.

Total: 43 testes passando no CI.

## Proximo passo — Sprint 2
Iniciar em nova branch a partir de develop apos merge do Bloco 3.
Ver arquivo Sprint1_Guia_ClaudeCode_v5.txt secao "PROXIMOS PASSOS — SPRINT 2":
  - Upload de video para S3/MinIO com URL pre-assinada
  - Worker de thumbnail com ffmpeg
  - Integracao Instagram Graph API (Reels)
  - Integracao TikTok API
  - Integracao YouTube Data API
  - Worker de publicacao BullMQ (retry + status)
  - Stripe: planos, trial, checkout e webhook
  - Limites por plano com middleware de quota
  - next-intl no frontend com os 3 idiomas
  - CI/CD frontend
