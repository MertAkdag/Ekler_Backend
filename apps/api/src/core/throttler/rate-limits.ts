import type { ThrottlerOptions } from '@nestjs/throttler'

/**
 * Named rate limiters — mirror the existing Supabase DB rate-limit triggers
 * (which stay as a backstop through Phase 3). ttl is in milliseconds (throttler v6).
 *
 * A lax `default` limiter applies to every route for baseline abuse protection.
 * Specific routes opt into a named limiter via `@Throttle({ confession: {} })`
 * (wired per-endpoint starting Phase 3).
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

export const THROTTLER_DEFINITIONS: ThrottlerOptions[] = Object.values(RATE_LIMITS)
