import { z } from 'zod'
import { listQuerySchema } from '../pagination'

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

export const confessionFeedQuerySchema = listQuerySchema.extend({
  filter: confessionFilterSchema.default('all'),
  sort: confessionSortSchema.default('recent'),
})
export type ConfessionFeedQuery = z.infer<typeof confessionFeedQuerySchema>

export const confessionItemSchema = z.object({
  id: z.string(),
  body: z.string(),
  category: confessionCategorySchema,
  imageUrl: z.string().nullable(),
  isAnonymous: z.boolean(),
  authorName: z.string().nullable(), // null/masked when anonymous
  likeCount: z.number().int().nonnegative(),
  commentCount: z.number().int().nonnegative(),
  hasLiked: z.boolean(),
  hasBookmarked: z.boolean(),
  createdAt: z.string(), // ISO
})
export type ConfessionItem = z.infer<typeof confessionItemSchema>

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
