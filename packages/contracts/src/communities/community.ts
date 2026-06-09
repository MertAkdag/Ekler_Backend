import { z } from 'zod'

/**
 * Communities feed — port of the RN direct `communities` read (no RPC existed).
 * University-scoped. The Supabase path ran two queries (communities + the caller's
 * community_members) and merged user_role/user_status in JS; the Node port does it in
 * one left-joined query. Not paginated (the RN screen loads the full list, then
 * client-side filters the "my"/"explore" tab).
 */
export const communityFeedQuerySchema = z.object({
  category: z.string().optional(), // optional category filter
})
export type CommunityFeedQuery = z.infer<typeof communityFeedQuerySchema>

export const communityCategorySchema = z.enum([
  'academic',
  'sports',
  'arts',
  'tech',
  'social',
  'general',
])
export const communityJoinTypeSchema = z.enum(['open', 'approval', 'invite'])

/** Create a community. university_domain + owner are server-set; owner auto-joins. */
export const createCommunityBodySchema = z.object({
  name: z.string().trim().min(2).max(80),
  description: z.string().max(2000).nullable().default(null),
  category: communityCategorySchema,
  joinType: communityJoinTypeSchema.default('open'),
  avatarUrl: z.string().nullable().default(null),
})
export type CreateCommunityBody = z.infer<typeof createCommunityBodySchema>

export const createCommunityResultSchema = z.object({ id: z.string() })
export type CreateCommunityResult = z.infer<typeof createCommunityResultSchema>

/** One feed row — the 8 columns the RN selects + the caller's membership fields. */
export const communityFeedRowSchema = z.object({
  id: z.string(),
  name: z.string(),
  description: z.string().nullable(),
  avatar_url: z.string().nullable(),
  category: z.string(),
  join_type: z.string(),
  member_count: z.number(),
  is_active: z.boolean(),
  user_role: z.string().nullable(),
  user_status: z.string().nullable(),
})
export type CommunityFeedRow = z.infer<typeof communityFeedRowSchema>
