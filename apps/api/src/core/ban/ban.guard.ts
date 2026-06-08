import { CanActivate, ExecutionContext, Inject, Injectable } from '@nestjs/common'
import { Reflector } from '@nestjs/core'
import { ClsService } from 'nestjs-cls'
import { sql } from 'drizzle-orm'
import { DRIZZLE, type Db } from '../../db/drizzle.module'
import { AppError } from '../errors/app-error'
import type { AppClsStore } from '../cls/cls-store'
import { IS_PUBLIC_KEY } from '../auth/public.decorator'

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
