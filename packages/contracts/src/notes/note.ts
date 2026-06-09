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
