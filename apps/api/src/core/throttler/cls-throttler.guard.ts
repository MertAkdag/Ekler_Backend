import { Injectable } from '@nestjs/common'
import { ThrottlerGuard } from '@nestjs/throttler'
import { ClsServiceManager } from 'nestjs-cls'

/**
 * ThrottlerGuard keyed by the authenticated user (from CLS) instead of IP, so
 * the limit follows the account across networks. Falls back to IP for public/
 * unauthenticated routes. Runs last in the guard chain.
 *
 * Storage defaults to in-memory; Phase 3 swaps in the Redis store
 * (@nestjs/throttler-storage-redis) so the limit is shared across web replicas.
 */
@Injectable()
export class ClsThrottlerGuard extends ThrottlerGuard {
  protected override async getTracker(req: Record<string, any>): Promise<string> {
    const principal = ClsServiceManager.getClsService().get('principal')
    return principal?.userId ?? req.ip ?? 'anonymous'
  }
}
