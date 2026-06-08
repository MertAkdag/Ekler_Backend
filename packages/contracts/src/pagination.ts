import { z } from 'zod'

/**
 * Keyset (cursor) pagination — applied to EVERY list endpoint.
 * Cursor is an opaque base64url encoding of `{ created_at, id }`; clients treat
 * it as a black box. Default page 20, hard max 100.
 */
export const DEFAULT_PAGE_SIZE = 20
export const MAX_PAGE_SIZE = 100

export const cursorPayloadSchema = z.object({
  created_at: z.string(), // ISO timestamp
  id: z.string(),
})
export type CursorPayload = z.infer<typeof cursorPayloadSchema>

export const listQuerySchema = z.object({
  limit: z.coerce.number().int().min(1).max(MAX_PAGE_SIZE).default(DEFAULT_PAGE_SIZE),
  cursor: z.string().min(1).optional(), // opaque base64url
})
export type ListQuery = z.infer<typeof listQuerySchema>

export const pageMetaSchema = z.object({
  cursor: z.string().nullable(),
  has_more: z.boolean(),
})
export type PageMeta = z.infer<typeof pageMetaSchema>

// The cursor is opaque to clients. Server-side encode/decode (Buffer-based) lives
// in apps/api so this shared package stays free of Node globals (RN consumes it too).
