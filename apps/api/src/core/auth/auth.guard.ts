import { CanActivate, ExecutionContext, Inject, Injectable } from '@nestjs/common'
import { Reflector } from '@nestjs/core'
import { ClsService } from 'nestjs-cls'
import { sql } from 'drizzle-orm'
import {
  createRemoteJWKSet,
  jwtVerify,
  decodeProtectedHeader,
  type JWTPayload,
  type JWTVerifyGetKey,
} from 'jose'
import { ENV, type Env } from '../../config/env'
import { DRIZZLE, type Db } from '../../db/drizzle.module'
import { AppError } from '../errors/app-error'
import type { AppClsStore, AuthPrincipal } from '../cls/cls-store'
import { IS_PUBLIC_KEY } from './public.decorator'
import { TokenService, OWN_KIDS } from '../../modules/auth/token.service'

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
    private readonly tokens: TokenService,
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
  ): Promise<{ payload: JWTPayload; tokenSource: 'own' | 'supabase' }> {
    // 1) Peek the header — UNTRUSTED, used only to route to the right verifier.
    let kid: string | undefined
    try {
      kid = decodeProtectedHeader(token).kid
    } catch {
      throw new AppError('UNAUTHENTICATED', 'Malformed token.')
    }
    const looksOwn = kid !== undefined && OWN_KIDS.has(kid)

    // 2) Own EdDSA path. Try first when the kid is ours; also try when there is
    //    no kid at all (own tokens always carry one, so this is cheap + safe).
    if (this.tokens.enabled && (looksOwn || kid === undefined)) {
      try {
        const payload = await this.tokens.verifyAccess(token) // pinned alg:EdDSA, iss, aud
        return { payload, tokenSource: 'own' }
      } catch (err) {
        if (err instanceof AppError) throw err
        // If the kid was explicitly OURS, a failure here is FATAL — never fall
        // back to the Supabase verifier for a token that claims to be ours.
        if (looksOwn) throw new AppError('UNAUTHENTICATED', 'Invalid or expired token.')
        // else: not ours → fall through to the legacy verifier.
      }
    }

    // 3) Legacy Supabase path (JWKS RS/ES, or HS256 secret). Each verifier pins
    //    its own algorithm so an HS-signed token can never reach an asymmetric
    //    key and vice-versa (alg-confusion mitigation).
    try {
      if (this.jwks) {
        const { payload } = await jwtVerify(token, this.jwks, {
          algorithms: ['RS256', 'ES256'],
        })
        return { payload, tokenSource: 'supabase' }
      }
      if (this.hsSecret) {
        const { payload } = await jwtVerify(token, this.hsSecret, {
          algorithms: ['HS256'],
        })
        return { payload, tokenSource: 'supabase' }
      }
    } catch {
      throw new AppError('UNAUTHENTICATED', 'Invalid or expired token.')
    }

    throw new AppError('UNAUTHENTICATED', 'Invalid or expired token.')
  }

  private async resolvePrincipal(
    sub: string,
    tokenSource: 'own' | 'supabase',
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
