import { Inject, Injectable, Logger } from '@nestjs/common'
import { sql } from 'drizzle-orm'
import type { Profile } from '@ekler/contracts'
import { DRIZZLE, type Db } from '../../db/drizzle.module'
import { ENV, type Env } from '../../config/env'
import { AppError } from '../../core/errors/app-error'
import { TokenService } from './token.service'
import { OtpService } from './otp.service'
import { EmailProvider } from './email.provider'

export interface AuthSession {
  access_token: string
  refresh_token: string
  token_type: 'bearer'
  expires_in: number
  user: Profile
}

const normalizeEmail = (raw: string): string => raw.trim().toLowerCase()
const emailDomain = (email: string): string => {
  const at = email.lastIndexOf('@')
  return at === -1 ? '' : email.slice(at + 1)
}

@Injectable()
export class AuthService {
  private readonly logger = new Logger('auth')

  constructor(
    @Inject(DRIZZLE) private readonly db: Db,
    @Inject(ENV) private readonly env: Env,
    private readonly tokens: TokenService,
    private readonly otp: OtpService,
    private readonly email: EmailProvider,
  ) {}

  /** POST /auth/otp/request — always 204 (anti-enumeration). `.edu.tr` already gated by DTO. */
  async requestOtp(emailRaw: string, ip: string | null, userAgent: string | null): Promise<void> {
    const email = normalizeEmail(emailRaw)
    const code = await this.otp.issue(email, ip, userAgent)
    try {
      await this.email.sendOtp(email, code)
    } catch (err) {
      this.logger.error(
        `OTP email send failed for ${email}`,
        err instanceof Error ? err.stack : String(err),
      )
      throw new AppError('INTERNAL', 'Kod gönderilemedi. Lütfen tekrar deneyin.')
    }
  }

  /** POST /auth/otp/verify — verify code, find-or-create user, mint session. */
  async verifyOtp(
    emailRaw: string,
    code: string,
    ip: string | null,
    userAgent: string | null,
  ): Promise<AuthSession> {
    const email = normalizeEmail(emailRaw)

    // Resolve canonical university domain BEFORE consuming the code, so an
    // unknown-university email never burns the user's OTP. Generic failure
    // (do not reveal "unknown university") for anti-enumeration.
    const domain = await this.resolveUniversityDomain(emailDomain(email))
    if (!domain) throw new AppError('OTP_INVALID', 'Geçersiz veya süresi dolmuş kod.')

    const result = await this.otp.verify(email, code)
    if (result === 'locked') {
      throw new AppError('OTP_LOCKED', 'Çok fazla yanlış deneme. Lütfen yeni bir kod iste.')
    }
    if (result === 'expired') {
      throw new AppError('OTP_EXPIRED', 'Kodun süresi doldu. Lütfen yeni bir kod iste.')
    }
    if (result !== 'ok') throw new AppError('OTP_INVALID', 'Geçersiz veya süresi dolmuş kod.')

    const userId = await this.findOrCreateUser(email, domain)
    const profile = await this.loadProfile(userId)
    return await this.mintSession(userId, email, domain, profile, ip, userAgent)
  }

  /** POST /auth/refresh — rotate; detect reuse (revoke family). */
  async refresh(presented: string, ip: string | null, userAgent: string | null): Promise<AuthSession> {
    const presentedHash = this.tokens.hashRefreshToken(presented)

    // The transaction RETURNS a discriminated outcome instead of throwing: a thrown
    // error rolls the tx back, which would also undo the breach-response revoke
    // (reuse → whole family). So we commit the revoke here, then reject outside.
    const outcome = await this.db.transaction(
      async (
        tx,
      ): Promise<{ kind: 'rejected' } | { kind: 'ok'; session: AuthSession }> => {
        const res = (await tx.execute(sql`
          select id, user_id, family_id, expires_at, family_expires_at, revoked_at
          from public.auth_sessions
          where refresh_token_hash = ${presentedHash}
          limit 1
          for update
        `)) as unknown as {
          rows: Array<{
            id: string
            user_id: string
            family_id: string
            expires_at: string
            family_expires_at: string
            revoked_at: string | null
          }>
        }
        const row = res.rows[0]
        if (!row) return { kind: 'rejected' }

        // Reuse detection: a token that was already rotated/revoked is replayed →
        // revoke the entire family (breach response). Committed via the returned outcome.
        if (row.revoked_at !== null) {
          await tx.execute(sql`
            update public.auth_sessions
               set revoked_at = now(), revoked_reason = 'reuse_detected'
             where family_id = ${row.family_id} and revoked_at is null
          `)
          return { kind: 'rejected' }
        }

        // Absolute family cap: a continuously-rotating (incl. silently-stolen) chain
        // dies once it passes family_expires_at, no matter the per-token TTL.
        if (new Date(row.family_expires_at).getTime() <= Date.now()) {
          await tx.execute(sql`
            update public.auth_sessions
               set revoked_at = now(), revoked_reason = 'family_expired'
             where family_id = ${row.family_id} and revoked_at is null
          `)
          return { kind: 'rejected' }
        }

        if (new Date(row.expires_at).getTime() <= Date.now()) {
          await tx.execute(sql`
            update public.auth_sessions
               set revoked_at = now(), revoked_reason = 'expired'
             where id = ${row.id}
          `)
          return { kind: 'rejected' }
        }

        // Rotate: mint new opaque token, insert child row (same family, same family
        // cap), revoke old.
        const newToken = this.tokens.generateRefreshToken()
        const newHash = this.tokens.hashRefreshToken(newToken)
        const expiresAt = new Date(Date.now() + this.env.AUTH_REFRESH_TTL * 1000)
        await tx.execute(sql`
          insert into public.auth_sessions
            (user_id, refresh_token_hash, family_id, parent_id, expires_at, family_expires_at, user_agent, ip)
          values
            (${row.user_id}, ${newHash}, ${row.family_id}, ${row.id},
             ${expiresAt.toISOString()}, ${row.family_expires_at}, ${userAgent}, ${ip})
        `)
        await tx.execute(sql`
          update public.auth_sessions
             set revoked_at = now(), revoked_reason = 'rotated'
           where id = ${row.id}
        `)

        const profile = await this.loadProfile(row.user_id, tx)
        const emailRow = (await tx.execute(sql`
          select email from public.profiles where id = ${row.user_id} limit 1
        `)) as unknown as { rows: Array<{ email: string }> }
        const email = emailRow.rows[0]?.email ?? ''
        const access = await this.tokens.signAccess({
          userId: row.user_id,
          email,
          universityDomain: profile.university_domain,
        })
        return {
          kind: 'ok',
          session: {
            access_token: access.token,
            refresh_token: newToken,
            token_type: 'bearer' as const,
            expires_in: access.expiresIn,
            user: profile,
          },
        }
      },
    )

    if (outcome.kind === 'rejected') {
      throw new AppError('INVALID_REFRESH', 'Oturum geçersiz.')
    }
    return outcome.session
  }

  /** POST /auth/logout — revoke the presented session (idempotent). */
  async logout(presented: string): Promise<void> {
    const presentedHash = this.tokens.hashRefreshToken(presented)
    await this.db.execute(sql`
      update public.auth_sessions
         set revoked_at = now(), revoked_reason = 'logout'
       where refresh_token_hash = ${presentedHash} and revoked_at is null
    `)
  }

  // ── internals ──────────────────────────────────────────────────────────────

  private async resolveUniversityDomain(domain: string): Promise<string | null> {
    if (!domain) return null
    const res = (await this.db.execute(sql`
      select public.resolve_university_domain(${domain}) as domain
    `)) as unknown as { rows: Array<{ domain: string | null }> }
    return res.rows[0]?.domain ?? null
  }

  /** Atomic find-or-create: auth.users (by lower(email)) then profiles (same-UUID). */
  private async findOrCreateUser(email: string, universityDomain: string): Promise<string> {
    return await this.db.transaction(async (tx) => {
      const inserted = (await tx.execute(sql`
        insert into auth.users (email, email_confirmed_at)
        values (${email}, now())
        on conflict (lower(email)) do nothing
        returning id
      `)) as unknown as { rows: Array<{ id: string }> }

      let userId = inserted.rows[0]?.id
      if (!userId) {
        const existing = (await tx.execute(sql`
          select id from auth.users where lower(email) = ${email} limit 1
        `)) as unknown as { rows: Array<{ id: string }> }
        userId = existing.rows[0]?.id
        if (!userId) throw new AppError('INTERNAL', 'Kullanıcı oluşturulamadı.')
      }

      // profiles.id == auth.users.id; only the 3 NOT-NULL user fields are set,
      // the rest use column DEFAULTs (is_admin/is_banned/is_restricted = false).
      await tx.execute(sql`
        insert into public.profiles (id, email, university_domain)
        values (${userId}, ${email}, ${universityDomain})
        on conflict (id) do nothing
      `)

      return userId
    })
  }

  private async loadProfile(userId: string, executor: Pick<Db, 'execute'> = this.db): Promise<Profile> {
    const res = (await executor.execute(sql`
      select id, full_name, username, avatar_url, university_domain, faculty, department,
             coalesce(is_admin, false)      as is_admin,
             coalesce(is_banned, false)     as is_banned,
             coalesce(is_restricted, false) as is_restricted,
             restriction_ends_at
      from public.profiles
      where id = ${userId}
      limit 1
    `)) as unknown as { rows: Array<Record<string, unknown>> }
    const row = res.rows[0]
    if (!row) throw new AppError('INTERNAL', 'Profil bulunamadı.')
    return {
      id: row.id as string,
      full_name: (row.full_name as string | null) ?? null,
      username: (row.username as string | null) ?? null,
      avatar_url: (row.avatar_url as string | null) ?? null,
      university_domain: row.university_domain as string,
      faculty: (row.faculty as string | null) ?? null,
      department: (row.department as string | null) ?? null,
      is_admin: Boolean(row.is_admin),
      is_banned: Boolean(row.is_banned),
      is_restricted: Boolean(row.is_restricted),
      restriction_ends_at: (row.restriction_ends_at as string | null) ?? null,
    }
  }

  private async mintSession(
    userId: string,
    email: string,
    universityDomain: string,
    profile: Profile,
    ip: string | null,
    userAgent: string | null,
  ): Promise<AuthSession> {
    const access = await this.tokens.signAccess({ userId, email, universityDomain })
    const refreshToken = this.tokens.generateRefreshToken()
    const refreshHash = this.tokens.hashRefreshToken(refreshToken)
    const now = Date.now()
    const expiresAt = new Date(now + this.env.AUTH_REFRESH_TTL * 1000)
    const familyExpiresAt = new Date(now + this.env.AUTH_FAMILY_TTL * 1000)
    await this.db.execute(sql`
      insert into public.auth_sessions
        (user_id, refresh_token_hash, family_id, expires_at, family_expires_at, user_agent, ip)
      values
        (${userId}, ${refreshHash}, gen_random_uuid(), ${expiresAt.toISOString()},
         ${familyExpiresAt.toISOString()}, ${userAgent}, ${ip})
    `)
    return {
      access_token: access.token,
      refresh_token: refreshToken,
      token_type: 'bearer',
      expires_in: access.expiresIn,
      user: profile,
    }
  }
}
