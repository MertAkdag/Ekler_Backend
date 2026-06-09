import { Throttle } from '@nestjs/throttler'
import type { ThrottlerOptions } from '@nestjs/throttler'

/**
 * Named rate limiters — mirror the existing Supabase DB rate-limit triggers
 * (which stay as a backstop through Phase 3). ttl is in milliseconds (throttler v6).
 *
 * Only the lax `default` limiter is registered globally (see CoreModule) for
 * baseline abuse protection. Stricter per-route limits are applied with the
 * `RateLimit()` decorator below, which OVERRIDES `default` for that one route.
 */
export const RATE_LIMITS = {
  default: { name: 'default', ttl: 60_000, limit: 120 },
  confession: { name: 'confession', ttl: 60_000, limit: 3 },
  comment: { name: 'comment', ttl: 60_000, limit: 10 },
  reaction: { name: 'reaction', ttl: 60_000, limit: 30 }, // like / vote / bookmark
  sessionJoin: { name: 'session-join', ttl: 60_000, limit: 5 },
  note: { name: 'note', ttl: 300_000, limit: 5 },
  report: { name: 'report', ttl: 3_600_000, limit: 5 },
  courseSuggest: { name: 'course-suggest', ttl: 3_600_000, limit: 10 },
} as const satisfies Record<string, ThrottlerOptions & { name: string }>

/**
 * Apply a stricter named limit to a single write route.
 *
 * throttler v6 applies EVERY registered named throttler to EVERY route, so we
 * register only `default` globally and override it here per route. The limit/ttl
 * come from RATE_LIMITS so the numbers live in one place; the limiter is still
 * keyed by the authenticated user (ClsThrottlerGuard.getTracker).
 *
 * Note: throttler storage is in-memory today (per-replica). Sharing the counter
 * across web replicas needs the Redis store (@nestjs/throttler-storage-redis) —
 * still TODO, harmless while we run a single instance.
 */
export const RateLimit = (key: Exclude<keyof typeof RATE_LIMITS, 'default'>) =>
  Throttle({ default: { limit: RATE_LIMITS[key].limit, ttl: RATE_LIMITS[key].ttl } })
