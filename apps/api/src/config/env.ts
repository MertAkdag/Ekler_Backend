import { z } from 'zod'

/**
 * Single zod-validated source of truth for process env. Fails fast at boot if a
 * required var is missing/malformed. Phase-gated vars are optional until their
 * phase lands (storage/redis/auth-keys), but DB + Supabase bridge are required.
 */
export const envSchema = z.object({
  NODE_ENV: z.enum(['development', 'test', 'production']).default('development'),
  PORT: z.coerce.number().int().positive().default(3000),
  LOG_LEVEL: z.enum(['fatal', 'error', 'warn', 'info', 'debug', 'trace']).default('info'),

  // Postgres
  DATABASE_URL: z.string().url(),
  DIRECT_DATABASE_URL: z.string().url().optional(),
  PG_POOL_MAX: z.coerce.number().int().positive().default(10),

  // Auth bridge (Supabase JWT verification during the dual-accept window)
  SUPABASE_URL: z.string().url().optional(),
  SUPABASE_JWKS_URL: z.string().url().optional(),
  SUPABASE_JWT_SECRET: z.string().optional(),
  SUPABASE_SERVICE_ROLE_KEY: z.string().optional(),

  // Own auth (Phase 8)
  //   AUTH_MODE — dual-accept toggle / server-side kill switch:
  //     'dual'      → accept own EdDSA tokens AND legacy Supabase tokens (migration window).
  //     'own_only'  → accept ONLY our own tokens (post-client-cutover hardening, pre-P9).
  //   Rollback is flipping back to 'dual'; never flip to 'own_only' before the client cutover.
  AUTH_MODE: z.enum(['dual', 'own_only']).default('dual'),
  AUTH_JWT_PRIVATE_KEY: z.string().optional(),
  AUTH_JWT_PUBLIC_KEY: z.string().optional(),
  AUTH_JWT_KID: z.string().default('ek-ed25519-1'),
  // Previous public key kept verify-only during a key rotation overlap (sign with the
  // new key, still accept tokens signed by the old one until they expire). Both required
  // together or neither.
  AUTH_JWT_PUBLIC_KEY_PREV: z.string().optional(),
  AUTH_JWT_KID_PREV: z.string().optional(),
  AUTH_OTP_PEPPER: z.string().optional(),
  AUTH_ACCESS_TTL: z.coerce.number().int().positive().default(900),
  AUTH_REFRESH_TTL: z.coerce.number().int().positive().default(2_592_000),
  // Absolute lifetime of a refresh-token family: a continuously-rotating chain
  // (incl. a silently-stolen one) is force-expired this long after first issue,
  // regardless of per-token TTL. Default 90d.
  AUTH_FAMILY_TTL: z.coerce.number().int().positive().default(7_776_000),

  // Object storage (Phase 4) — provider-neutral S3 API. Works against self-hosted
  // MinIO (our VPS), Cloudflare R2, or AWS S3; only these values differ. Storage
  // is DISABLED until endpoint + keys are present (StorageService.enabled).
  //   MinIO note: set STORAGE_FORCE_PATH_STYLE=true (MinIO needs path-style URLs).
  STORAGE_ENDPOINT: z.string().url().optional(),
  STORAGE_REGION: z.string().default('auto'),
  STORAGE_ACCESS_KEY_ID: z.string().optional(),
  STORAGE_SECRET_ACCESS_KEY: z.string().optional(),
  STORAGE_FORCE_PATH_STYLE: z
    .preprocess((v) => (typeof v === 'string' ? v === '1' || v.toLowerCase() === 'true' : v), z.boolean())
    .default(true),
  // Public base URL for the public bucket (communities) — direct, un-signed reads.
  STORAGE_PUBLIC_URL: z.string().url().optional(),
  STORAGE_BUCKET_CONFESSIONS: z.string().default('ekler-confessions'),
  STORAGE_BUCKET_NOTES: z.string().default('ekler-notes'),
  STORAGE_BUCKET_COMMUNITIES: z.string().default('ekler-communities'),
  STORAGE_SIGN_TTL: z.coerce.number().int().positive().default(3_600), // signed-read URL TTL (s)
  STORAGE_UPLOAD_MAX_BYTES: z.coerce.number().int().positive().default(20 * 1024 * 1024),

  // Infra (phase-gated)
  REDIS_URL: z.string().optional(),
  SENTRY_DSN: z.string().optional(),
  RESEND_API_KEY: z.string().optional(),
  OTP_EMAIL_FROM: z.string().optional(),
})

export type Env = z.infer<typeof envSchema>

export const ENV = Symbol('ENV')

export function loadEnv(source: NodeJS.ProcessEnv = process.env): Env {
  const parsed = envSchema.safeParse(source)
  if (!parsed.success) {
    const issues = parsed.error.issues
      .map((i) => `  - ${i.path.join('.') || '(root)'}: ${i.message}`)
      .join('\n')
    throw new Error(`Invalid environment configuration:\n${issues}`)
  }
  return parsed.data
}
