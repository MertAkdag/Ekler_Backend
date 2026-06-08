import 'dotenv/config'
import { defineConfig } from 'drizzle-kit'

/**
 * Introspection-ONLY config. Drizzle never owns DDL during the strangler —
 * the schema owner is Supabase migrations. `db:pull` regenerates ./src/db/schema
 * from the live database; CI diffs the result to catch drift.
 *
 * Uses DIRECT_DATABASE_URL (non-pooled) — pull/migration tooling must bypass the
 * Supavisor pooler.
 */
export default defineConfig({
  dialect: 'postgresql',
  schema: './src/db/schema',
  // Introspection writes generated schema.ts/relations.ts here.
  out: './src/db/schema',
  dbCredentials: {
    url: process.env.DIRECT_DATABASE_URL ?? process.env.DATABASE_URL ?? '',
  },
  // `auth` is included so public FKs to auth.users resolve. We bridge against
  // auth.users today and replace it with app_users (same-UUID) in Phase 8.
  schemaFilter: ['public', 'auth'],
  tablesFilter: ['*'],
  // Generated TS uses camelCase props mapped to snake_case columns; the runtime
  // client mirrors this with `casing: 'snake_case'`.
  casing: 'camelCase',
  verbose: true,
  strict: true,
})
