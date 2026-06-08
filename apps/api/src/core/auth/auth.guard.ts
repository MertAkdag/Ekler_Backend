import { CanActivate, ExecutionContext, Inject, Injectable } from '@nestjs/common'
import { Reflector } from '@nestjs/core'
import { ClsService } from 'nestjs-cls'
import { sql } from 'drizzle-orm'
import {
  createRemoteJWKSet,
  jwtVerify,
  type JWTPayload,
  type JWTVerifyGetKey,
} from 'jose'
import { ENV, type Env } from '../../config/env'
import { DRIZZLE, type Db } from '../../db/drizzle.module'
import { AppError } from '../errors/app-error'
import type { AppClsStore, AuthPrincipal } from '../cls/cls-store'
import { IS_PUBLIC_KEY } from './public.decorator'

/**
 * Dual-accept auth bridge.
 *
 * During the migration window this verifies Supabase-issued JWTs against the
 * project JWKS (or the legacy HS256 secret). Phase 8 adds our own EdDSA tokens
 * behind the same guard — same verify surface, `tokenSource` flips.
 *
 * The verified `sub` is the user's id across ALL systems (same-UUID trick:
 * auth.users.id == profiles.id == JWT sub), so no id translation is ever needed.
 *
 * After verifying, the principal — crucially `universityDomain` — is resolved
 * from `profiles` (the canonical domain, never the email/token) and written into
 * CLS + onto the request for `@CurrentUser()`.
 */
@Injectable()
export class AuthGuard implements CanActivate {
  private jwks: JWTVerifyGetKey | null = null
  private hsSecret: Uint8Array | null = null

  constructor(
    @Inject(ENV) private readonly env: Env,
    @Inject(DRIZZLE) private readonly db: Db,
    private readonly reflector: Reflector,
    private readonly cls: ClsService<AppClsStore>,
  ) {
    if (env.SUPABASE_JWKS_URL) {
      this.jwks = createRemoteJWKSet(new URL(env.SUPABASE_JWKS_URL))
    } else if (env.SUPABASE_JWT_SECRET) {
      this.hsSecret = new TextEncoder().encode(env.SUPABASE_JWT_SECRET)
    }
  }

  async canActivate(ctx: ExecutionContext): Promise<boolean> {
    const isPublic = this.reflector.getAllAndOverride<boolean>(IS_PUBLIC_KEY, [
      ctx.getHandler(),
      ctx.getClass(),
    ])
    if (isPublic) return true

    const req = ctx.switchToHttp().getRequest()
    const token = this.extractBearer(req.headers?.authorization)
    if (!token) throw new AppError('UNAUTHENTICATED', 'Missing bearer token.')

    const payload = await this.verify(token)
    const sub = payload.sub
    if (!sub) throw new AppError('UNAUTHENTICATED', 'Token has no subject.')

    const principal = await this.resolvePrincipal(sub)
    this.cls.set('principal', principal)
    req.principal = principal
    return true
  }

  private extractBearer(header: unknown): string | null {
    if (typeof header !== 'string') return null
    const [scheme, value] = header.split(' ')
    return scheme?.toLowerCase() === 'bearer' && value ? value.trim() : null
  }

  private async verify(token: string): Promise<JWTPayload> {
    try {
      if (this.jwks) {
        const { payload } = await jwtVerify(token, this.jwks)
        return payload
      }
      if (this.hsSecret) {
        const { payload } = await jwtVerify(token, this.hsSecret)
        return payload
      }
      throw new AppError(
        'INTERNAL',
        'Auth not configured: set SUPABASE_JWKS_URL or SUPABASE_JWT_SECRET.',
      )
    } catch (err) {
      if (err instanceof AppError) throw err
      throw new AppError('UNAUTHENTICATED', 'Invalid or expired token.')
    }
  }

  private async resolvePrincipal(sub: string): Promise<AuthPrincipal> {
    // Canonical domain comes from profiles, not the token. A verified token with
    // no profile yet (mid-onboarding) is valid but unscoped.
    const result = (await this.db.execute(sql`
      select university_domain, coalesce(is_admin, false) as is_admin,
             coalesce(is_banned, false) as is_banned
      from public.profiles
      where id = ${sub}
      limit 1
    `)) as unknown as { rows: Array<Record<string, unknown>> }

    const row = result.rows[0]
    return {
      userId: sub,
      universityDomain: (row?.university_domain as string | null) ?? '',
      isAdmin: Boolean(row?.is_admin),
      isBanned: Boolean(row?.is_banned),
      isRestricted: false, // BanGuard resolves the self-healing truth on write routes
      restrictionEndsAt: null,
      tokenSource: 'supabase',
    }
  }
}
