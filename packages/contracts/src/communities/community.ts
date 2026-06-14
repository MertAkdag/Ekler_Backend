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

// ─── Detail + sub-resources (Wave D) ─────────────────────────────────────────
// GET /communities/:id returns one CommunityFeedRow (detail = single feed row).

/** POST /communities/:id/members — join (open→active, else pending). */
export const joinCommunityResultSchema = z.object({ status: z.enum(['active', 'pending']) })
export type JoinCommunityResult = z.infer<typeof joinCommunityResultSchema>

/** A community member with the joined profile + presence (presence null until Wave E). */
export const communityMemberRowSchema = z.object({
  id: z.string(),
  community_id: z.string(),
  user_id: z.string(),
  role: z.string(),
  status: z.string(),
  created_at: z.string(),
  full_name: z.string().nullable(),
  username: z.string().nullable(),
  avatar_url: z.string().nullable(),
  is_online: z.boolean().nullable(),
  last_seen_at: z.string().nullable(),
})
export type CommunityMemberRow = z.infer<typeof communityMemberRowSchema>

/** PATCH /communities/:id/members/:memberId — approve a pending join / change role. */
export const memberActionBodySchema = z.object({
  action: z.enum(['approve', 'promote', 'demote']),
})
export type MemberActionBody = z.infer<typeof memberActionBodySchema>

/** A community post + author display. */
export const communityPostRowSchema = z.object({
  id: z.string(),
  community_id: z.string(),
  author_id: z.string(),
  body: z.string(),
  image_url: z.string().nullable(),
  is_pinned: z.boolean(),
  created_at: z.string(),
  author_name: z.string().nullable(),
})
export type CommunityPostRow = z.infer<typeof communityPostRowSchema>

export const createCommunityPostBodySchema = z.object({
  body: z.string().trim().min(1).max(2000),
  image_url: z.string().nullable().default(null),
})
export type CreateCommunityPostBody = z.infer<typeof createCommunityPostBodySchema>

/** A community event. */
export const communityEventRowSchema = z.object({
  id: z.string(),
  community_id: z.string(),
  author_id: z.string(),
  title: z.string(),
  description: z.string().nullable(),
  location: z.string().nullable(),
  starts_at: z.string(),
  ends_at: z.string().nullable(),
  created_at: z.string(),
})
export type CommunityEventRow = z.infer<typeof communityEventRowSchema>

export const createCommunityEventBodySchema = z.object({
  title: z.string().trim().min(2).max(120),
  description: z.string().trim().max(2000).nullable().default(null),
  location: z.string().trim().max(200).nullable().default(null),
  starts_at: z.string().datetime({ offset: true }),
  ends_at: z.string().datetime({ offset: true }).nullable().default(null),
})
export type CreateCommunityEventBody = z.infer<typeof createCommunityEventBodySchema>
