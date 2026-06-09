import { z } from 'zod'

/**
 * Canonical error codes. MUST stay symmetric with the RN client's
 * `services/ServiceError.ts` so client and server speak the same vocabulary.
 * The HTTP status each maps to lives server-side in AllExceptionFilter.
 */
export const ERROR_CODES = [
  'VALIDATION_FAILED', // 422
  'UNAUTHENTICATED', // 401
  'FORBIDDEN', // 403
  'USER_BANNED', // 403
  'NOT_SESSION_CREATOR', // 403
  'ACCOUNT_QUARANTINED', // 410
  'RATE_LIMIT_EXCEEDED', // 429
  'MODERATION_BLOCKED', // 422
  'NOT_FOUND', // 404 (also cross-university access — never leak existence)
  'CONFLICT', // 409 (PG 23505 unique violation)
  'UNIVERSITY_SCOPE_MISSING', // 500 — fail-closed guardrail, should never reach a client
  'INTERNAL', // 500
  'OTP_INVALID', // 422 — wrong/expired/missing/locked OTP (generic, anti-enumeration)
  'OTP_EXPIRED', // 410 — reserved; service currently folds expiry into OTP_INVALID
  'OTP_LOCKED', // 429 — too many failed attempts on a code
  'INVALID_REFRESH', // 401 — refresh token invalid/rotated/reused/expired
] as const

export type ErrorCode = (typeof ERROR_CODES)[number]
export const errorCodeSchema = z.enum(ERROR_CODES)

export const errorBodySchema = z.object({
  error: z.object({
    code: errorCodeSchema,
    message: z.string(),
    details: z.record(z.string(), z.unknown()).optional(),
  }),
})
export type ErrorBody = z.infer<typeof errorBodySchema>
