# Social Media Platform

Plataforma SaaS de gestão de redes sociais que permite publicar e agendar posts em Instagram, TikTok e YouTube, gerenciar múltiplos clientes por acesso e acompanhar métricas de desempenho.

---

## Desenvolvimento

Este projeto é desenvolvido e mantido com auxílio de IA (vibecoding), utilizando como ferramenta principal de geração e evolução do código. Todo o código gerado passa por revisão, ajuste e validação humana — cada entrega é vistoriada por desenvolvedores antes de ser integrada ao repositório.

---

## O que é a plataforma

Uma ferramenta centralizada para quem precisa gerenciar presença digital em múltiplas redes sociais. O usuário conecta suas contas de Instagram, TikTok e YouTube, agenda publicações, e acompanha os resultados — tudo em um único painel.

---

## Para quem é

| Persona | Tipo de conta | Descrição |
|---|---|---|
| **Social Media / Gestor** | `AGENCY` | Gerencia N clientes. Cada cliente tem suas próprias redes sociais vinculadas. |
| **Influencer / Negócio local** | `SELF` | É o próprio cliente. Gerencia suas próprias redes sociais diretamente. |

---

## Stack tecnológica

### Backend
- **Runtime:** Node.js + TypeScript
- **Framework:** Fastify
- **ORM:** Prisma
- **Banco de dados:** PostgreSQL
- **Fila de jobs:** BullMQ + Redis
- **Armazenamento de arquivos:** S3 (MinIO em ambiente local)
- **Autenticação:** JWT + OAuth2
- **Testes:** Vitest + @fastify/inject
- **CI/CD:** GitHub Actions

### Frontend
- **Framework:** Next.js 14 (App Router) + TypeScript
- **Estilos:** Tailwind CSS
- **Componentes:** shadcn/ui
- **Estado global:** Zustand
- **Requisições:** TanStack Query
- **Formulários:** React Hook Form + Zod

### Internacionalização (i18n)
- **Idiomas suportados:** `pt-BR` (padrão), `es`, `en`
- **Backend:** i18next com detecção via `Accept-Language` e `User.locale`
- **Frontend:** next-intl
- **Arquivos de tradução:** `packages/i18n/locales/{pt-BR,es,en}/`

### Infraestrutura
- **Local:** Docker Compose
- **HML e PROD:** Railway ou Render

---

## Estrutura do monorepo

```
.
├── apps/
│   ├── api/          # Backend Fastify (Node.js + TypeScript)
│   └── web/          # Frontend Next.js 14 App Router
├── packages/
│   ├── db/           # Schema Prisma + migrations
│   ├── shared/       # Tipos TypeScript compartilhados entre apps
│   └── i18n/         # Arquivos de tradução e utilitários i18n
├── infra/            # Docker Compose, variáveis de ambiente
└── .github/
    └── workflows/    # Pipelines CI/CD (ci, deploy-hml, deploy-prod)
```

O projeto usa **pnpm workspaces** para gerenciar os pacotes do monorepo.

---

## Como rodar localmente

### Pré-requisitos
- Node.js 20+
- pnpm
- Docker + Docker Compose

### Passo a passo

```bash
# 1. Clone o repositório
git clone <url-do-repo>
cd social-platform

# 2. Instale as dependências
pnpm install

# 3. Configure as variáveis de ambiente
cp .env.example .env.local
# Edite .env.local com seus valores locais

# 4. Suba os containers (PostgreSQL, Redis, MinIO)
bash scripts/dev-up.sh
# O script sobe os containers, aguarda o PostgreSQL,
# roda as migrations e executa o seed.

# 5. Inicie o backend
pnpm --filter api dev

# 6. Inicie o frontend (em outro terminal)
pnpm --filter web dev
```

A API estará disponível em `http://localhost:3001` e o frontend em `http://localhost:3000`.

### Variáveis de ambiente (local)

Copie `.env.example` para `.env.local` e preencha os campos. Os valores padrão para desenvolvimento local são:

| Variável | Valor padrão local |
|---|---|
| `DATABASE_URL` | `postgresql://user:pass@localhost:5432/socialplatform_dev` |
| `REDIS_URL` | `redis://localhost:6379` |
| `S3_ENDPOINT` | `http://localhost:9000` (MinIO) |
| `S3_BUCKET` | `socialplatform-local` |
| `STRIPE_SECRET_KEY` | *(vazio — não usado em local)* |
| `DEFAULT_LOCALE` | `pt-BR` |
| `APP_URL` | `http://localhost:3000` |
| `API_URL` | `http://localhost:3001` |

---

## Ambientes

| | **local** | **hml** | **prod** |
|---|---|---|---|
| Finalidade | Desenvolvimento | Validação e testes | Usuários reais |
| Banco | PostgreSQL via Docker | PostgreSQL dedicado | PostgreSQL dedicado + backups diários |
| Stripe | Não configurado | Test mode (`sk_test_...`) | Live mode (`sk_live_...`) |
| E-mails | `console.log` | Serviço real (domínio de teste) | Serviço real (domínio de produção) |
| Storage | MinIO Docker local | S3 bucket separado | S3 bucket de produção |
| Branch | Qualquer feature branch | `develop` | `main` |
| Deploy | Manual | Automático no push para `develop` | Manual com aprovação obrigatória |
| Migrations | `prisma migrate dev` | Automáticas no deploy | **NUNCA automáticas — execução manual com aprovação** |

---

## Branch strategy e fluxo de deploy

```
feature/nome-da-feature
        │
        └─── Pull Request ──► develop ──► deploy automático ──► HML
                                  │
                                  └─── Pull Request ──► main ──► aprovação manual ──► PROD

hotfix/nome-do-fix ──────────────────────────────► Pull Request ──► main (emergências)
```

### Regras de proteção de branch
- **`develop`:** requer PR + CI passando antes do merge
- **`main`:** requer PR + CI passando + 1 aprovador antes do merge

### Migrations em PROD
Migrations **nunca rodam automaticamente em PROD**. O fluxo correto é:
1. Revisar e aprovar o script de migration
2. Executar `prisma migrate deploy` manualmente no banco de PROD
3. Confirmar aplicação bem-sucedida
4. Liberar o deploy

---

## Convenções do projeto

### i18n — internacionalização
- **Nunca** escrever mensagens de erro em hardcode no código
- Toda mensagem usa chave de tradução: `t('errors.invalidEmail')`
- E-mails e notificações também usam chaves traduzidas
- Idioma padrão: `pt-BR`
- Idioma do usuário: salvo em `User.locale`
- Idioma da requisição: detectado via header `Accept-Language`
- Arquivos de tradução: `packages/i18n/locales/{pt-BR,es,en}/`

### LGPD (Lei Geral de Proteção de Dados)
- É prioridade máxima — toda feature que toca dados pessoais exige `AuditLog`
- Consentimento de `TERMS` e `PRIVACY` é obrigatório antes de criar o `User`
- Consentimento de `COOKIES` pode ser registrado antes do login (via `sessionId`)
- Após login, o `sessionId` é vinculado ao `userId`
- Job diário processa solicitações de exclusão com carência de 30 dias
- `AuditLog` e `ConsentRecord` são mantidos após exclusão (LGPD Art. 37)

### Multi-tenancy
- Cada `Workspace` é um tenant isolado
- Nenhuma rota expõe dados de outro workspace
- Acesso cruzado entre tenants retorna `403 Forbidden`

### Hierarquia de dados
```
User (locale: pt-BR | es | en)
  └── WorkspaceMember
        └── Workspace (accountType: AGENCY | SELF)
              └── Client (isSelf: boolean)
                    └── SocialAccount (INSTAGRAM | TIKTOK | YOUTUBE)
```

- `SocialAccount` é sempre vinculada ao `Client`, **nunca** diretamente ao `Workspace`
- Conta `SELF`: 1 `Client` com `isSelf: true`, criado automaticamente no registro, sem possibilidade de adicionar mais clientes
- Conta `AGENCY`: N `Clients` com `isSelf: false`

### Segurança
- Nenhuma rota criada sem autenticação (exceto rotas públicas explícitas)
- Campos sensíveis (`password`, `passwordHash`, `accessToken`, `refreshToken`, `twoFaSecret`) **nunca** aparecem em logs
- Secrets **nunca** compartilhados entre ambientes
- Tokens de reset de senha expiram em 1 hora
- Refresh tokens são rotacionados a cada uso

### Mensagens de erro
Formato padrão de resposta de erro:
```json
{
  "error": "ERROR_CODE",
  "message": "Mensagem traduzida no idioma do usuário"
}
```

---

## Links úteis

- **Stripe Dashboard:** https://dashboard.stripe.com
- **Railway:** https://railway.app
- **Render:** https://render.com
- **Prisma Docs:** https://www.prisma.io/docs
- **Fastify Docs:** https://fastify.dev/docs
- **Next.js Docs:** https://nextjs.org/docs
- **BullMQ Docs:** https://docs.bullmq.io
- **shadcn/ui:** https://ui.shadcn.com
- **next-intl:** https://next-intl-docs.vercel.app
- **i18next:** https://www.i18next.com
