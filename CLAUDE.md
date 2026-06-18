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
- Toda mensagem usa chave: t('errors.invalidEmail')
- E-mails e notificacoes tambem usam chaves traduzidas
- Idioma padrao: pt-BR
- Idioma do usuario: salvo em User.locale
- Idioma da requisicao: detectado via Accept-Language

## Estrutura de pastas
apps/api           -> backend Fastify
apps/web           -> Next.js 14 App Router
packages/db        -> schema Prisma + migrations
packages/shared    -> tipos TypeScript compartilhados
packages/i18n      -> arquivos de traducao compartilhados
infra/             -> docker, variaveis de ambiente
.github/workflows/ -> pipelines CI/CD

## Modelo de dados central
User (locale: pt-BR | es | en)
  -> WorkspaceMember -> Workspace (accountType: AGENCY | SELF)
                            -> Client (isSelf: boolean)
                                  -> SocialAccount (INSTAGRAM | TIKTOK | YOUTUBE)
