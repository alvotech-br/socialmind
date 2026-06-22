# Registro de Testes — Sprint 1

Documento com todos os testes manuais e automatizados executados durante o Sprint 1.
Validados localmente via Postman e terminal por Lucca Macedo.

---

## Ambiente de teste local

- Node.js 22.23.0
- pnpm 11.8.0
- Docker Desktop (Windows)
- PostgreSQL 16 via Docker (porta 5432)
- Redis 7 via Docker (porta 6379)
- API rodando em http://localhost:3001

---

## Bloco 1 — Infraestrutura

### Terminal

| Comando | Resultado esperado | Status |
|---|---|---|
| `docker compose up -d` | Todos os containers sobem (postgres, redis, minio) | ✅ |
| `pnpm install` | Dependencias instaladas sem erro | ✅ |
| `pnpm --filter db migrate:dev` | Migration `20260619004415_init` aplicada | ✅ |
| `pnpm --filter db seed` | Seed popula AGENCY (pt-BR) e SELF (en) | ✅ |
| `pnpm dev:api` | API escutando em http://0.0.0.0:3001 | ✅ |

---

## Bloco 2 — Autenticacao e Onboarding

### Testes automatizados (Vitest)

Arquivo: `apps/api/src/routes/auth.test.ts` e `apps/api/src/routes/privacy.test.ts`

| Suite | Teste | Status |
|---|---|---|
| POST /auth/register/step1 | Cria usuario e retorna sessionToken | ✅ |
| POST /auth/register/step1 | Bloqueia quando LGPD nao aceito (400 LGPD_CONSENT_REQUIRED) | ✅ |
| POST /auth/register/step1 | Retorna 409 se email ja existe | ✅ |
| POST /auth/register/step1 | Retorna 400 para senha fraca | ✅ |
| POST /auth/register/step1 | Vincula cookieSessionId ao usuario criado | ✅ |
| POST /auth/register/step2 | Cria workspace SELF e retorna sessionToken | ✅ |
| POST /auth/register/step2 | Nao cria client quando accountType AGENCY | ✅ |
| POST /auth/register/step2 | Retorna 401 sem token | ✅ |
| POST /auth/register/step3 | Retorna accessToken e cria AuditLog | ✅ |
| POST /auth/login | Retorna accessToken para credenciais validas | ✅ |
| POST /auth/login | Retorna 401 para senha errada | ✅ |
| POST /auth/login | Retorna 401 para usuario inexistente (anti-enumeration) | ✅ |
| POST /auth/login | Retorna requires2FA quando 2FA habilitado | ✅ |
| POST /auth/refresh | Retorna 401 sem cookie refreshToken | ✅ |
| POST /auth/refresh | Retorna 401 com token revogado | ✅ |
| POST /auth/logout | Revoga token e retorna ok | ✅ |
| POST /auth/logout | Retorna 401 sem autenticacao | ✅ |
| POST /auth/forgot-password | Retorna ok:true mesmo para email inexistente (anti-enumeration) | ✅ |
| POST /auth/forgot-password | Retorna ok:true e cria token para email existente | ✅ |
| POST /auth/reset-password | Reseta a senha com token valido | ✅ |
| POST /auth/reset-password | Retorna 400 para token invalido | ✅ |
| POST /auth/reset-password | Retorna 400 para senha fraca | ✅ |
| POST /privacy/consents/cookies | Grava sem autenticacao (201) | ✅ |
| POST /privacy/consents/cookies | Retorna erro se accepted != true | ✅ |
| POST /privacy/consents/cookies | Retorna erro se sessionId ausente | ✅ |
| POST /privacy/consents/cookies/link-user | Vincula sessionId ao userId com token valido | ✅ |
| POST /privacy/consents/cookies/link-user | Retorna 401 sem autenticacao | ✅ |

**Total: 28 testes automatizados**

---

### Testes manuais via Postman — Bloco 2

#### 1. GET /health
```
GET http://localhost:3001/health
```
**Resposta esperada:** 200
```json
{
  "status": "ok",
  "timestamp": "2026-06-19T...",
  "version": "0.0.1",
  "env": "development"
}
```
**Resultado:** ✅ 200 OK

---

#### 2. POST /privacy/consents/cookies
```
POST http://localhost:3001/privacy/consents/cookies
Content-Type: application/json

{
  "accepted": true,
  "sessionId": "sess-teste-001",
  "version": "v1.0"
}
```
**Resposta esperada:** 201
```json
{
  "recorded": true,
  "consentId": "..."
}
```
**Resultado:** ✅ 201 Created

---

#### 3. POST /auth/register/step1
```
POST http://localhost:3001/auth/register/step1
Content-Type: application/json

{
  "name": "Lucca Teste",
  "email": "lucca2@teste.com",
  "password": "Senha123",
  "acceptedTerms": true,
  "acceptedPrivacy": true,
  "cookieSessionId": "sess-teste-001"
}
```
**Resposta esperada:** 201
```json
{
  "sessionToken": "eyJ..."
}
```
**Resultado:** ✅ 201 Created

> Obs: sessionToken retornado usado nas etapas seguintes como Bearer token

---

#### 4. POST /auth/register/step2
```
POST http://localhost:3001/auth/register/step2
Authorization: Bearer <sessionToken do step1>
Content-Type: application/json

{
  "accountType": "SELF"
}
```
**Resposta esperada:** 200
```json
{
  "sessionToken": "eyJ..."
}
```
**Resultado:** ✅ 200 OK

> Obs: primeiro retornou "request.t is not a function" — corrigido movendo hook i18n de preHandler para onRequest

---

#### 5. POST /auth/register/step3
```
POST http://localhost:3001/auth/register/step3
Authorization: Bearer <sessionToken do step2>
```
**Resposta esperada:** 200
```json
{
  "user": {
    "id": "2a26333f-35ff-4ee7-b2b9-8c7704a25eda",
    "name": "Lucca Teste",
    "email": "lucca2@teste.com",
    "locale": "pt-BR"
  },
  "workspace": {
    "id": "ae7a11ff-603a-49bc-9928-08731820c02e",
    "slug": "lucca-teste-1781901096240",
    "accountType": "SELF"
  },
  "trial": {
    "endsAt": "2026-07-03T20:31:36.241Z",
    "daysLeft": 14
  },
  "accessToken": "eyJ..."
}
```
**Resultado:** ✅ 200 OK

---

#### 6. POST /auth/login
```
POST http://localhost:3001/auth/login
Content-Type: application/json

{
  "email": "lucca2@teste.com",
  "password": "Senha123"
}
```
**Resposta esperada:** 200 com accessToken
**Resultado:** ✅ 200 OK

---

### Bugs encontrados e corrigidos no Bloco 2

| Bug | Causa | Correcao |
|---|---|---|
| `"request.t is not a function"` no step2 | Hook i18n em `preHandler` roda depois do `onRequest` onde o authenticate executa | Movido hook para `onRequest` em `plugins/i18n.ts` |
| Mensagem retornada como chave (`"errors.unauthorized"`) | Separador de namespace i18next e `:` nao `.` | Substituido `t('errors.key')` por `t('errors:key')` em todos os arquivos |
| 401 no step2 com token valido | Faltava prefixo `Bearer ` no header Authorization | Adicionado `Bearer ` antes do token no Postman |

---

## Bloco 3 — Multi-tenancy, Clientes e LGPD

### Testes automatizados (Vitest)

| Suite | Teste | Status |
|---|---|---|
| workspace-context | Usuario sem membership recebe 403 traduzido | ✅ |
| workspace-context | clientId de outro workspace retorna 404 traduzido | ✅ |
| workspace-context | Workspace SELF injeta clientId automaticamente | ✅ |
| POST /workspaces/:id/clients | SELF bloqueado de criar client — erro traduzido em pt-BR | ✅ |
| POST /workspaces/:id/clients | AGENCY OWNER cria client com sucesso (201) | ✅ |
| POST /workspaces/:id/clients | AGENCY VIEWER bloqueado — 403 | ✅ |
| DELETE /workspaces/:id/clients/:id | Deletar client isSelf e bloqueado | ✅ |
| DELETE /workspaces/:id/clients/:id | Acesso cruzado entre workspaces retorna 404 | ✅ |
| PATCH /workspaces/:id | VIEWER editando workspace retorna 403 traduzido | ✅ |
| PATCH /workspaces/:id | OWNER edita workspace com sucesso | ✅ |
| DELETE /workspaces/:id/members/:userId | Remover membro OWNER e bloqueado | ✅ |
| DELETE /workspaces/:id/members/:userId | Remover membro VIEWER com sucesso (204) | ✅ |
| runDataDeletionJob | Solicitacao com menos de 30 dias nao e processada | ✅ |
| runDataDeletionJob | Solicitacao com mais de 30 dias anonimiza o usuario | ✅ |
| runDataDeletionJob | AuditLog nao e deletado apos anonimizacao | ✅ |

**Total: 15 testes automatizados (43 no total com Bloco 2)**

---

### Testes manuais via Postman — Bloco 3

#### 7. GET /privacy/my-data
```
GET http://localhost:3001/privacy/my-data
Authorization: Bearer <accessToken>
```
**Resposta esperada:** 200 com dados do usuario sem campos sensiveis
**Resultado:** ✅ 200 OK
```json
{
  "user": { "id": "...", "email": "lucca2@teste.com", "name": "Lucca Teste", ... },
  "workspaces": [{ "role": "OWNER", "workspace": { "accountType": "SELF", ... } }],
  "consents": [
    { "consentType": "TERMS", "version": "v1.0", "locale": "pt-BR" },
    { "consentType": "PRIVACY", "version": "v1.0", "locale": "pt-BR" }
  ],
  "deletionRequests": []
}
```
> Confirmado: sem passwordHash, twoFaSecret, accessToken nem refreshToken

---

#### 8. GET /workspaces/:id/clients
```
GET http://localhost:3001/workspaces/ae7a11ff-603a-49bc-9928-08731820c02e/clients
Authorization: Bearer <accessToken>
X-Workspace-Id: ae7a11ff-603a-49bc-9928-08731820c02e
```
**Resultado:** ✅ 200 OK
```json
[
  {
    "id": "30ad07e6-...",
    "name": "Lucca Teste",
    "isSelf": true,
    "socialAccountsCount": 0
  }
]
```
> Client isSelf criado automaticamente no registro confirmado

---

#### 9. GET /workspaces/:id/members
```
GET http://localhost:3001/workspaces/ae7a11ff-603a-49bc-9928-08731820c02e/members
Authorization: Bearer <accessToken>
X-Workspace-Id: ae7a11ff-603a-49bc-9928-08731820c02e
```
**Resultado:** ✅ 200 OK
```json
[
  {
    "role": "OWNER",
    "user": { "id": "...", "name": "Lucca Teste", "email": "lucca2@teste.com", "locale": "pt-BR" }
  }
]
```

---

#### 10. POST /workspaces/:id/clients em workspace SELF (bloqueio de negocio)
```
POST http://localhost:3001/workspaces/ae7a11ff-603a-49bc-9928-08731820c02e/clients
Authorization: Bearer <accessToken>
X-Workspace-Id: ae7a11ff-603a-49bc-9928-08731820c02e
Content-Type: application/json

{
  "name": "Cliente Teste"
}
```
**Resposta esperada:** 403 com mensagem traduzida
**Resultado:** ✅ 403 Forbidden
```json
{
  "error": "FORBIDDEN",
  "message": "Uma conta própria não pode ter clientes adicionais"
}
```

---

#### 11. POST /privacy/delete-account
```
POST http://localhost:3001/privacy/delete-account
Authorization: Bearer <accessToken>
Content-Type: application/json

{
  "reason": "Teste de exclusão"
}
```
**Resultado:** ✅ 201 Created
```json
{
  "deletionRequestId": "bbc5ccd0-fbfd-4877-aff9-db6a5ebabea6",
  "status": "PENDING"
}
```

---

#### 12. DELETE /privacy/delete-account/cancel
```
DELETE http://localhost:3001/privacy/delete-account/cancel
Authorization: Bearer <accessToken>
```
**Resultado:** ✅ 200 OK
```json
{
  "cancelled": true
}
```

---

## Resumo geral

| Bloco | Testes automatizados | Testes manuais | Status |
|---|---|---|---|
| Bloco 1 — Infra | — | 5 (terminal) | ✅ |
| Bloco 2 — Auth | 28 | 6 (Postman) | ✅ |
| Bloco 3 — Multi-tenancy/LGPD | 15 | 6 (Postman) | ✅ |
| **Total** | **43** | **17** | ✅ |

CI GitHub Actions: lint ✅ typecheck ✅ tests ✅ build ✅
