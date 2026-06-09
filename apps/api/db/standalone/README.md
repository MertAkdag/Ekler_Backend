# Standalone DB (P7 — off Supabase)

Recreates the entire app schema on a **vanilla PostgreSQL 17**, with **no data**
(empty start — existing Supabase data is not migrated), so the Node backend can run
**completely independent of Supabase**.

## What this is

`pg_dump --schema-only --schema=public` of the Supabase database, plus the minimal
shims that let it stand on its own:

- **`00-roles.sql`** — the cluster roles the dump references in ownership / GRANTs /
  `CREATE POLICY ... TO authenticated` (`postgres`, `anon`, `authenticated`,
  `service_role`, `authenticator`, `supabase_admin`).
- **`01-bootstrap.sql`** — `pg_trgm` (installed into an `extensions` schema so the
  `extensions.gin_trgm_ops` index opclasses resolve) + `btree_gist` (one EXCLUDE
  constraint) + a **shell `auth` schema**: an empty `auth.users` table (34 FKs point
  at it) and `auth.uid()` / `auth.role()` / `auth.jwt()` reading the transaction-local
  `request.jwt.claims` GUC — exactly how the kept-in-DB moderation RPCs expect it.
- **`02-schema.sql`** — the public schema: 62 tables, 243 functions (incl. the
  moderation engine `evaluate_moderation_rules` / `create_confession_v2` / …),
  15 triggers, 199 indexes, 124 RLS policies.

## Run

```bash
PGPORT=5433 ./setup.sh
# then point the API at it:
DATABASE_URL=postgresql://$(whoami)@localhost:5433/ekler
```

Verified: `GET /v1/universities/by-domain` returns seeded data from this DB with the
API connected here and nothing pointing at Supabase.

## Notes / next

- **RLS is inert here:** the API connects as a superuser/bypassrls role and enforces
  university tenancy itself (`ScopedRepository`). Policies are kept for parity; they’re
  dropped wholesale in P9.
- **Auth shim is temporary:** P8 replaces the empty `auth.users` shell + the Supabase
  JWKS bridge with our own OTP auth (own `app_users`, EdDSA tokens). Until then the
  shim keeps the schema + FKs + `auth.uid()` working.
- **Production host:** this proves the cutover on a local PG17. Moving to a managed
  host (Neon) is a `DATABASE_URL` swap + applying these same three files there.
- `02-schema.sql` is a point-in-time snapshot of the Supabase schema; refresh it with
  `pg_dump --schema-only --schema=public --no-owner --no-privileges` (pg_dump 17).
