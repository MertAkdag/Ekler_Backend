import { z } from 'zod'
import { DEFAULT_PAGE_SIZE, MAX_PAGE_SIZE } from '../pagination'

/**
 * Notes (ders notları) feed — port of the Supabase RPC `get_notes_feed`.
 * The RPC is not cursor-paginated (single capped load) and neither is the RN
 * screen, so the Node feed mirrors that: course filter + sort + limit, returning
 * a plain array of the RPC's 18 snake_case columns. Keyset pagination can be added
 * here later (the plan's "cursor everywhere") once the notes screen grows infinite
 * scroll — adding it now would be unused machinery.
 */
export const noteSortSchema = z.enum(['recent', 'popular'])
export type NoteSort = z.infer<typeof noteSortSchema>

export const noteFeedQuerySchema = z.object({
  course_id: z.string().uuid().optional(),
  sort: noteSortSchema.default('recent'),
  limit: z.coerce.number().int().min(1).max(MAX_PAGE_SIZE).default(DEFAULT_PAGE_SIZE),
})
export type NoteFeedQuery = z.infer<typeof noteFeedQuerySchema>

/** Vote on a note: 'up' | 'down' | null (null removes the caller's vote). */
export const noteVoteBodySchema = z.object({
  direction: z.enum(['up', 'down']).nullable(),
})
export type NoteVoteBody = z.infer<typeof noteVoteBodySchema>

/** One feed row — the EXACT columns get_notes_feed returns, snake_case (RN maps it). */
export const noteFeedRowSchema = z.object({
  id: z.string(),
  author_id: z.string(),
  course_id: z.string(),
  title: z.string(),
  description: z.string().nullable(),
  file_url: z.string(),
  file_type: z.string(),
  file_size_bytes: z.number().nullable(),
  download_count: z.number().nullable(),
  vote_score: z.number().nullable(),
  comment_count: z.number().nullable(),
  created_at: z.string(),
  is_flagged: z.boolean(),
  course_code: z.string(),
  course_name: z.string(),
  author_name: z.string(),
  user_vote: z.string().nullable(), // 'up' | 'down' | null
  is_mine: z.boolean(),
})
export type NoteFeedRow = z.infer<typeof noteFeedRowSchema>

// ─── Write surface (Wave C) ──────────────────────────────────────────────────

/** POST /notes — create a note record (the file is uploaded to storage first; this carries its key). */
export const createNoteBodySchema = z.object({
  course_id: z.string().uuid(),
  title: z.string().trim().min(2).max(120),
  description: z.string().trim().max(300).nullable().optional(),
  file_url: z.string().min(1), // storage object key
  file_type: z.enum(['pdf', 'image']).default('pdf'),
  file_size_bytes: z.number().int().nonnegative().nullable().optional(),
})
export type CreateNoteBody = z.infer<typeof createNoteBodySchema>
export const createNoteResultSchema = z.object({ id: z.string() })
export type CreateNoteResult = z.infer<typeof createNoteResultSchema>

/** GET /notes/:id/comments — accountable (username shown), keyset ASC by (created_at, id). */
export const noteCommentRowSchema = z.object({
  id: z.string(),
  body: z.string(),
  created_at: z.string(),
  is_mine: z.boolean(),
  user_id: z.string(),
  author_name: z.string().nullable(),
  author_username: z.string().nullable(),
  author_avatar: z.string().nullable(),
})
export type NoteCommentRow = z.infer<typeof noteCommentRowSchema>

export const noteCommentsQuerySchema = z.object({
  limit: z.coerce.number().int().min(1).max(MAX_PAGE_SIZE).default(DEFAULT_PAGE_SIZE),
  cursor_created_at: z.string().optional(),
  cursor_id: z.string().uuid().optional(),
})
export type NoteCommentsQuery = z.infer<typeof noteCommentsQuerySchema>

export const createNoteCommentBodySchema = z.object({
  body: z.string().trim().min(1).max(500),
})
export type CreateNoteCommentBody = z.infer<typeof createNoteCommentBodySchema>
