import { CanActivate, ExecutionContext, Inject, Injectable } from '@nestjs/common'
import { Reflector } from '@nestjs/core'
import { ClsService } from 'nestjs-cls'
import { sql } from 'drizzle-orm'
import { DRIZZLE, type Db } from '../../db/drizzle.module'
import { AppError } from '../errors/app-error'
import type { AppClsStore } from '../cls/cls-store'
import { ALLOW_BANNED_KEY, IS_PUBLIC_KEY } from '../auth/public.decorator'

const WRITE_METHODS = new Set(['POST', 'PUT', 'PATCH', 'DELETE'])

/**
 * Gates banned/restricted users out of write routes. Reads use the snapshot only;
 * writes consult the DB source-of-truth functions:
 *   - is_user_banned(uuid)       → permanent/temp ban  → 403 USER_BANNED
 *   - is_user_restricted(uuid)   → self-healing quarantine → 410 ACCOUNT_QUARANTINED
 * Runs AFTER AuthGuard (principal already in CLS).
 */
@Injectable()
export class BanGuard implements CanActivate {
  constructor(
    @Inject(DRIZZLE) private readonly db: Db,
    private readonly reflector: Reflector,
    private readonly cls: ClsService<AppClsStore>,
  ) {}

  async canActivate(ctx: ExecutionContext): Promise<boolean> {
    const isPublic = this.reflector.getAllAndOverride<boolean>(IS_PUBLIC_KEY, [
      ctx.getHandler(),
      ctx.getClass(),
    ])
    if (isPublic) return true

    // Rights/legal/safety/housekeeping writes a banned user must still reach
    // (consent, GDPR delete, appeals, presence, notifications, device-tokens,
    // blocks). Marked with @AllowBanned() — keep it METHOD-scoped (class-level
    // would silently exempt every future write on the controller).
    //
    // AuthGuard already ran, so the principal is verified — we only skip the
    // ban/restriction gate. Tradeoff: the SELECT below also self-heals expired
    // restrictions as a side effect (is_user_restricted clears is_restricted/
    // is_banned). Returning early skips that heal, so a user whose ONLY traffic
    // is exempt routes keeps a stale is_restricted flag until their next gated
    // write. Deliberate: the heal is idempotent and fires on any gated write /
    // content RPC, is_user_banned re-checks expiry live on every gated write,
    // and presence is a 60s heartbeat — a per-beat DB call would undo the
    // 10k-DAU QPS work for a cosmetic edge case.
    const allowBanned = this.reflector.getAllAndOverride<boolean>(ALLOW_BANNED_KEY, [
      ctx.getHandler(),
      ctx.getClass(),
    ])
    if (allowBanned) return true

    const principal = this.cls.get('principal')
    if (!principal) return true // AuthGuard already enforced; nothing to gate

    const req = ctx.switchToHttp().getRequest()
    const isWrite = WRITE_METHODS.has(String(req.method).toUpperCase())
    if (!isWrite) return true

    const result = (await this.db.execute(sql`
      select public.is_user_banned(${principal.userId}) as banned,
             public.is_user_restricted(${principal.userId}) as restricted
    `)) as unknown as { rows: Array<{ banned: boolean; restricted: boolean }> }

    const row = result.rows[0]
    if (row?.banned) throw new AppError('USER_BANNED', 'Account is banned.')
    if (row?.restricted) {
      throw new AppError('ACCOUNT_QUARANTINED', 'Account is temporarily restricted.')
    }
    return true
  }
}
