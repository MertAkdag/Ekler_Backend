import { z } from 'zod'
import { DEFAULT_PAGE_SIZE, MAX_PAGE_SIZE } from '../pagination'

/**
 * Kürsü (anonymous confessions) — moved into contracts FIRST per the migration
 * plan, since Kürsü is the first domain to cut over to the Node read path.
 * Shapes mirror the RN domain types (lib/mappers/confessionMapper) — camelCase
 * on the wire, snake_case in the DB.
 */

export const CONFESSION_CATEGORIES = ['confession', 'question', 'complaint', 'funny'] as const
export const confessionCategorySchema = z.enum(CONFESSION_CATEGORIES)
export type ConfessionCategory = (typeof CONFESSION_CATEGORIES)[number]

export const confessionSortSchema = z.enum(['recent', 'trending'])
export type ConfessionSort = z.infer<typeof confessionSortSchema>

/** `all` | `bookmarks` | a category key. */
export const confessionFilterSchema = z.union([
  z.literal('all'),
  z.literal('bookmarks'),
  confessionCategorySchema,
])
export type ConfessionFilter = z.infer<typeof confessionFilterSchema>

/**
 * Feed query — mirrors get_confessions_feed_v2's params. Cursor is the raw
 * `(created_at, id)` keyset (not the opaque base64url default) because the RN feed
 * already models its cursor as `{ createdAt, id }`; keeping the same shape makes the
 * Node path a drop-in (zero client churn, zero-diff parity). `meta.cursor` (opaque)
 * is still returned for future clients.
 */
export const confessionFeedQuerySchema = z.object({
  filter: confessionFilterSchema.default('all'),
  sort: confessionSortSchema.default('recent'),
  limit: z.coerce.number().int().min(1).max(MAX_PAGE_SIZE).default(DEFAULT_PAGE_SIZE),
  cursor_created_at: z.string().optional(),
  cursor_id: z.string().uuid().optional(),
})
export type ConfessionFeedQuery = z.infer<typeof confessionFeedQuerySchema>

/**
 * One feed row — the EXACT 15 columns get_confessions_feed_v2 returns, snake_case,
 * so the RN client runs both the Node and Supabase paths through the identical
 * `mapConfessionRow` (image resolution + boolean coercion). `category` stays a plain
 * string (DB is not enum-constrained); the client casts.
 */
export const confessionFeedRowSchema = z.object({
  id: z.string(),
  body: z.string(),
  category: z.string(),
  image_url: z.string().nullable(),
  is_anonymous: z.boolean(),
  like_count: z.number().int(),
  comment_count: z.number().int(),
  is_flagged: z.boolean(),
  created_at: z.string(),
  is_mine: z.boolean(),
  has_liked: z.boolean(),
  has_bookmarked: z.boolean(),
  author_name: z.string().nullable(),
  author_username: z.string().nullable(),
  author_avatar: z.string().nullable(),
})
export type ConfessionFeedRow = z.infer<typeof confessionFeedRowSchema>

export const createConfessionBodySchema = z.object({
  body: z.string().trim().min(1).max(500),
  category: confessionCategorySchema,
  imagePath: z.string().nullable().default(null),
  isAnonymous: z.boolean().default(true),
})
export type CreateConfessionBody = z.infer<typeof createConfessionBodySchema>

export const createConfessionResultSchema = z.object({
  status: z.enum(['published', 'needs_review', 'blocked']),
  confessionId: z.string().nullable(),
  moderationLabel: z.string().nullable(),
  message: z.string().nullable(),
})
export type CreateConfessionResult = z.infer<typeof createConfessionResultSchema>
