# ekler-backend

Ekler'in Supabase'den tam çıkış backend'i — **NestJS 11 (Fastify) + Drizzle + Postgres**.
Strangler-fig geçiş; master plan: `~/.claude/plans/selam-senle-uzun-soluklu-resilient-pumpkin.md`.

## Workspace yapısı (pnpm)

```
packages/contracts   @ekler/contracts — RN ile paylaşılan zod şemaları (envelope, error code, pagination, domain DTO). TEK zod v4 kopyası.
apps/api             @ekler/api       — NestJS/Fastify HTTP API (web process)
apps/worker          @ekler/worker    — BullMQ consumer + @nestjs/schedule cron (Phase 5+)
apps/admin           @ekler/admin     — AdminJS (ayrı Express process, Phase 5+)
```

## Cross-cutting sözleşmeler (değişmez)

- **Response envelope:** `{ data, meta:{cursor,has_more} }` / hata `{ error:{code,message,details} }`.
- **University-scope (anti-K-1):** scoped tablolara TEK erişim `ScopedRepository` üzerinden; CLS'teki `universityDomain` her query/insert'e zorla enjekte edilir. Raw `db` ile scoped tabloya dokunmak yasak (lint + `ScopedTable` brand).
- **Guard sırası (load-bearing):** ClsGuard → AuthGuard → BanGuard → ThrottlerGuard.
- **Hata kodları** RN `services/ServiceError.ts` ile simetrik.

## Local kurulum

```bash
nvm use                 # node 22
corepack enable
pnpm install
cp .env.example apps/api/.env   # değerleri doldur (en azından DATABASE_URL + SUPABASE_*)
pnpm dev:api            # http://localhost:3010/v1/health
```

### Drizzle — mevcut şemayı çek (introspection-only)

Drizzle **DDL sahibi değildir**; şema sahibi Supabase migration'larıdır. Tipleri çekmek için:

```bash
pnpm db:pull            # DIRECT_DATABASE_URL'e bağlanır, apps/api/src/db/schema/* üretir
pnpm db:check           # CI drift: pull çıktısı commit'le diff'lenir
```

Üretilen şema per-domain dosyalara bölünür; composite PK / CHECK→TS union / MV-view `.existing()` elle eklenir; GIN/GIST/EXCLUDE index DDL strip edilir (sahibi migration).

### Auth keys (Phase 8 — Ed25519)

```bash
openssl genpkey -algorithm ed25519 -out ed25519-private.pem
openssl pkey -in ed25519-private.pem -pubout -out ed25519-public.pem
# PEM içeriğini AUTH_JWT_PRIVATE_KEY / AUTH_JWT_PUBLIC_KEY env'lerine koy.
```

## Provision edilecek dış servisler (kullanıcı görevi)

| Servis | Ne için | Faz |
|---|---|---|
| Supabase (mevcut) | Geçişte PG/Auth/Storage kaynağı + JWKS | P0 |
| Upstash Redis | BullMQ + throttler + presence | P3/P5 |
| Cloudflare R2 | Object storage (5 bucket + ekler-exports) | P4 |
| Neon | Hedef PG host | P7 |
| Resend | OTP email | P8 |
| Fly.io | web + worker host | P0 deploy |
| Sentry | hata izleme | P0 |

## Faz durumu

- [x] **P0 (devam)** — workspace + Nest/Fastify skeleton + CoreModule guard zinciri + Drizzle provider + ScopedRepository iskeleti + AuthGuard Supabase JWKS bridge.
- [ ] P1 auth bridge + read-only catalog/me · P2 read feeds · P3 writes+moderation · P4 storage · P5 edge/jobs/push · P6 realtime · P7 DB cutover · P8 auth cutover · P9 decommission.
