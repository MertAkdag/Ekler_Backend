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
  AUTH_JWT_PRIVATE_KEY: z.string().optional(),
  AUTH_JWT_PUBLIC_KEY: z.string().optional(),
  AUTH_OTP_PEPPER: z.string().optional(),
  AUTH_ACCESS_TTL: z.coerce.number().int().positive().default(900),
  AUTH_REFRESH_TTL: z.coerce.number().int().positive().default(2_592_000),

  // Infra (phase-gated)
  REDIS_URL: z.string().optional(),
  SENTRY_DSN: z.string().optional(),
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
