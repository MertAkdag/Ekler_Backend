import type { ErrorCode } from '@ekler/contracts'

/**
 * Server-side error carrying a canonical code. Symmetric with the RN client's
 * `services/ServiceError.ts`. AllExceptionFilter maps `code` → HTTP status.
 */
export class AppError extends Error {
  constructor(
    readonly code: ErrorCode,
    message?: string,
    readonly details?: Record<string, unknown>,
  ) {
    super(message ?? code)
    this.name = 'AppError'
  }
}

/** Canonical code → HTTP status. The single place this mapping lives. */
export const ERROR_STATUS: Record<ErrorCode, number> = {
  VALIDATION_FAILED: 422,
  UNAUTHENTICATED: 401,
  FORBIDDEN: 403,
  USER_BANNED: 403,
  NOT_SESSION_CREATOR: 403,
  ACCOUNT_QUARANTINED: 410,
  RATE_LIMIT_EXCEEDED: 429,
  MODERATION_BLOCKED: 422,
  NOT_FOUND: 404,
  CONFLICT: 409,
  UNIVERSITY_SCOPE_MISSING: 500,
  INTERNAL: 500,
  OTP_INVALID: 422,
  OTP_EXPIRED: 410,
  OTP_LOCKED: 429,
  INVALID_REFRESH: 401,
}
