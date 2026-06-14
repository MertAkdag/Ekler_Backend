import { Inject, Injectable } from '@nestjs/common'
import { sql } from 'drizzle-orm'
import { createHmac, randomInt, timingSafeEqual } from 'node:crypto'
import { ENV, type Env } from '../../config/env'
import { DRIZZLE, type Db } from '../../db/drizzle.module'
import { AppError } from '../../core/errors/app-error'

const OTP_TTL_MS = 10 * 60 * 1000 // 10 min
const RESEND_COOLDOWN_SECONDS = 60
const MAX_REQUESTS_PER_HOUR = 5

interface OtpRow {
  id: string
  code_hash_hex: string // encode(code_hash,'hex') — forced text so drizzle's bytea handling can't corrupt it
  expires_at: string
  attempts: number
  max_attempts: number
}

/** Discriminated verify outcome → distinct error codes (locked=429, expired=410). */
export type OtpResult = 'ok' | 'invalid' | 'expired' | 'locked'

/**
 * OTP generation, hashing (HMAC-pepper), and constant-time verify with lockout.
 * Uses the raw `db` (NOT ScopedRepository) — auth touches public.auth_otp_codes
 * by email, not by university scope, and runs on @Public() routes with no principal.
 */
@Injectable()
export class OtpService {
  constructor(
    @Inject(DRIZZLE) private readonly db: Db,
    @Inject(ENV) private readonly env: Env,
  ) {}

  private hash(code: string): Buffer {
    const pepper = this.env.AUTH_OTP_PEPPER
    if (!pepper) throw new AppError('INTERNAL', 'AUTH_OTP_PEPPER not configured.')
    return createHmac('sha256', pepper).update(code).digest()
  }

  /** 6-digit CSPRNG code, uniform 000000-999999. */
  private generateCode(): string {
    return randomInt(0, 1_000_000).toString().padStart(6, '0')
  }

  /**
   * Create (or supersede) the active code for an email. Per-email rate limits are
   * enforced here against the DB (cross-replica safe). Returns the PLAINTEXT code
   * for the email provider to send. Caller already validated `.edu.tr`.
   */
  async issue(email: string, ip: string | null, userAgent: string | null): Promise<string> {
    // Per-email throttles (DB-backed; source of truth across replicas).
    const counts = (await this.db.execute(sql`
      select
        count(*) filter (where created_at > now() - interval '1 hour')                                  as last_hour,
        count(*) filter (where created_at > now() - ${`${RESEND_COOLDOWN_SECONDS} seconds`}::interval)  as last_min
      from public.auth_otp_codes
      where email = ${email}
    `)) as unknown as { rows: Array<{ last_hour: string; last_min: string }> }
    const c = counts.rows[0]
    if (c && Number(c.last_min) > 0) {
      throw new AppError('RATE_LIMIT_EXCEEDED', 'Lütfen tekrar denemeden önce bekleyin.')
    }
    if (c && Number(c.last_hour) >= MAX_REQUESTS_PER_HOUR) {
      throw new AppError('RATE_LIMIT_EXCEEDED', 'Çok fazla kod talebi. Daha sonra tekrar deneyin.')
    }

    const code = this.generateCode()
    const codeHash = this.hash(code)
    const expiresAt = new Date(Date.now() + OTP_TTL_MS)

    try {
      await this.db.transaction(async (tx) => {
        // Supersede any existing active code (the partial-unique index forbids two).
        await tx.execute(sql`
          update public.auth_otp_codes
             set consumed_at = now()
           where email = ${email} and consumed_at is null
        `)
        await tx.execute(sql`
          insert into public.auth_otp_codes
            (email, code_hash, expires_at, requester_ip, user_agent)
          values
            (${email}, ${codeHash}, ${expiresAt.toISOString()}, ${ip}, ${userAgent})
        `)
      })
    } catch (err) {
      // Two near-simultaneous first-ever requests race the partial-unique index;
      // the loser's 23505 is effectively a duplicate request → rate-limit, not a 500.
      const code23505 =
        (err as { cause?: { code?: string } })?.cause?.code ?? (err as { code?: string })?.code
      if (code23505 === '23505') {
        throw new AppError('RATE_LIMIT_EXCEEDED', 'Lütfen tekrar denemeden önce bekleyin.')
      }
      throw err
    }

    return code
  }

  /**
   * Constant-time verify with atomic attempt-increment + lockout. On the LAST
   * failed attempt the code is consumed (lockout-by-invalidate). On success the
   * code is consumed. Returns true ONLY on a correct, live code.
   *
   * Generic failure for every wrong/expired/locked/missing case (anti-enumeration);
   * the caller maps the boolean to OTP_INVALID.
   */
  async verify(email: string, code: string): Promise<OtpResult> {
    const candidate = this.hash(code)
    return await this.db.transaction(async (tx) => {
      const res = (await tx.execute(sql`
        select id, encode(code_hash, 'hex') as code_hash_hex, expires_at, attempts, max_attempts
        from public.auth_otp_codes
        where email = ${email} and consumed_at is null
        order by created_at desc
        limit 1
        for update
      `)) as unknown as { rows: OtpRow[] }
      const row = res.rows[0]
      if (!row) return 'invalid' // no active code

      if (new Date(row.expires_at).getTime() <= Date.now()) {
        await tx.execute(sql`
          update public.auth_otp_codes set consumed_at = now() where id = ${row.id}
        `)
        return 'expired' // expired → invalidate
      }

      // code_hash is read as hex text (encode(...,'hex')) so drizzle's bytea handling
      // can't corrupt it — decode back to the raw 32 bytes for a constant-time compare.
      const stored = Buffer.from(row.code_hash_hex, 'hex')
      const ok = stored.length === candidate.length && timingSafeEqual(stored, candidate)
      if (!ok) {
        // TEMP debug — stored vs computed; equal-but-failing ⇒ compare bug, different ⇒ wrong/superseded row.
        // eslint-disable-next-line no-console
        console.warn(
          `[otp-debug] mismatch email=${email} storedLen=${stored.length} stored=${row.code_hash_hex} cand=${candidate.toString('hex')}`,
        )
      }

      if (ok) {
        await tx.execute(sql`
          update public.auth_otp_codes set consumed_at = now() where id = ${row.id}
        `)
        return 'ok'
      }

      // Wrong code → increment; consume (lock out) if we just hit max.
      const nextAttempts = row.attempts + 1
      if (nextAttempts >= row.max_attempts) {
        await tx.execute(sql`
          update public.auth_otp_codes
             set attempts = ${nextAttempts}, consumed_at = now()
           where id = ${row.id}
        `)
        return 'locked'
      }
      await tx.execute(sql`
        update public.auth_otp_codes set attempts = ${nextAttempts} where id = ${row.id}
      `)
      return 'invalid'
    })
  }
}
