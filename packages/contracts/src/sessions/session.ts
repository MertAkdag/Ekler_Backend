import { z } from 'zod'
import { DEFAULT_PAGE_SIZE, MAX_PAGE_SIZE } from '../pagination'

/**
 * Study sessions feed — port of the Supabase RPC `get_sessions_feed`.
 * Not cursor-paginated (single capped load, like the RN radar screen). `course_ids`
 * arrives as a comma-separated list of uuids (only meaningful for filter=my_courses).
 */
export const sessionFilterSchema = z.enum(['all', 'my_courses'])
export type SessionFilter = z.infer<typeof sessionFilterSchema>

export const sessionFeedQuerySchema = z.object({
  filter: sessionFilterSchema.default('all'),
  // accepts "uuid,uuid" (RN) or an array (repeated param); empty/absent → []
  course_ids: z.preprocess(
    (v) =>
      typeof v === 'string'
        ? v.split(',').filter(Boolean)
        : Array.isArray(v)
          ? v
          : [],
    z.array(z.string().uuid()).default([]),
  ),
  limit: z.coerce.number().int().min(1).max(MAX_PAGE_SIZE).default(DEFAULT_PAGE_SIZE),
})
export type SessionFeedQuery = z.infer<typeof sessionFeedQuerySchema>

/** One feed row — the EXACT 17 columns get_sessions_feed returns, snake_case. */
export const sessionFeedRowSchema = z.object({
  id: z.string(),
  creator_id: z.string(),
  title: z.string().nullable(),
  description: z.string().nullable(),
  location_name: z.string(),
  location_lat: z.number().nullable(),
  location_lng: z.number().nullable(),
  starts_at: z.string(),
  ends_at: z.string().nullable(),
  max_participants: z.number(),
  participant_count: z.number(),
  status: z.string(),
  created_at: z.string(),
  course_code: z.string(),
  course_name: z.string(),
  creator_name: z.string(),
  has_joined: z.boolean(),
})
export type SessionFeedRow = z.infer<typeof sessionFeedRowSchema>
