import { CanActivate, ExecutionContext, Inject, Injectable } from '@nestjs/common'
import { Reflector } from '@nestjs/core'
import { ClsService } from 'nestjs-cls'
import { sql } from 'drizzle-orm'
import { type JWTPayload } from 'jose'
import { DRIZZLE, type Db } from '../../db/drizzle.module'
import { AppError } from '../errors/app-error'
import type { AppClsStore, AuthPrincipal } from '../cls/cls-store'
import { IS_PUBLIC_KEY } from './public.decorator'
import { TokenService } from '../../modules/auth/token.service'

/**
 * Auth guard — own EdDSA OTP tokens only.
 *
 * Verifies our own EdDSA-signed access tokens (TokenService pins alg:EdDSA /
 * iss / aud). The verified `sub` is the user's id across ALL systems (same-UUID
 * trick: auth.users.id == profiles.id == JWT sub), so no id translation is needed.
 *
 * After verifying, the principal — crucially `universityDomain` — is resolved
 * from `profiles` (the canonical domain, never the email/token) and written into
 * CLS + onto the request for `@CurrentUser()`.
 */
@Injectable()
export class AuthGuard implements CanActivate {
  constructor(
    @Inject(DRIZZLE) private readonly db: Db,
    private readonly reflector: Reflector,
    private readonly cls: ClsService<AppClsStore>,
    private readonly tokens: TokenService,
  ) {}

  async canActivate(ctx: ExecutionContext): Promise<boolean> {
    const isPublic = this.reflector.getAllAndOverride<boolean>(IS_PUBLIC_KEY, [
      ctx.getHandler(),
      ctx.getClass(),
    ])
    if (isPublic) return true

    const req = ctx.switchToHttp().getRequest()
    const token = this.extractBearer(req.headers?.authorization)
    if (!token) throw new AppError('UNAUTHENTICATED', 'Missing bearer token.')

    const { payload, tokenSource } = await this.verify(token)
    const sub = payload.sub
    if (!sub) throw new AppError('UNAUTHENTICATED', 'Token has no subject.')

    const principal = await this.resolvePrincipal(sub, tokenSource)
    this.cls.set('principal', principal)
    req.principal = principal
    return true
  }

  private extractBearer(header: unknown): string | null {
    if (typeof header !== 'string') return null
    const [scheme, value] = header.split(' ')
    return scheme?.toLowerCase() === 'bearer' && value ? value.trim() : null
  }

  private async verify(
    token: string,
  ): Promise<{ payload: JWTPayload; tokenSource: 'own' }> {
    if (!this.tokens.enabled) {
      throw new AppError('UNAUTHENTICATED', 'Auth is not configured.')
    }
    try {
      const payload = await this.tokens.verifyAccess(token) // pinned alg:EdDSA, iss, aud
      return { payload, tokenSource: 'own' }
    } catch (err) {
      if (err instanceof AppError) throw err
      throw new AppError('UNAUTHENTICATED', 'Invalid or expired token.')
    }
  }

  private async resolvePrincipal(
    sub: string,
    tokenSource: 'own',
  ): Promise<AuthPrincipal> {
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
      tokenSource,
    }
  }
}
