import { z } from 'zod'

/** Max paths a single signed-image / signed-note batch may request. */
export const MAX_SIGN_PATHS = 20

export const signPathsBodySchema = z.object({
  paths: z.array(z.string().min(1)).min(1).max(MAX_SIGN_PATHS),
  /** Requested TTL (s); server clamps to [1, 86400]. */
  expiresIn: z.number().int().positive().max(86_400).optional(),
})
export type SignPathsBody = z.infer<typeof signPathsBodySchema>

export const signedItemSchema = z.object({
  path: z.string(),
  signedUrl: z.string(),
  expiresAt: z.string(),
})
export type SignedItem = z.infer<typeof signedItemSchema>

export const signPathsResponseSchema = z.object({
  items: z.array(signedItemSchema),
  failed: z.array(z.object({ path: z.string(), error: z.string() })),
})
export type SignPathsResponse = z.infer<typeof signPathsResponseSchema>

/** Writable buckets clients may request an upload URL for. */
export const STORAGE_BUCKETS = ['confessions', 'notes', 'communities'] as const
export type StorageBucket = (typeof STORAGE_BUCKETS)[number]

export const uploadUrlBodySchema = z.object({
  bucket: z.enum(STORAGE_BUCKETS),
  contentType: z.string().min(1),
  /** Exact byte length; pinned into the presigned PUT so the client can't exceed it. */
  contentLength: z.number().int().positive(),
})
export type UploadUrlBody = z.infer<typeof uploadUrlBodySchema>

export const uploadUrlResponseSchema = z.object({
  /** Presigned PUT URL — client uploads the bytes directly. */
  url: z.string(),
  /** The server-forced object key (`{userId}/...`) — store this, not the URL. */
  key: z.string(),
  expiresAt: z.string(),
})
export type UploadUrlResponse = z.infer<typeof uploadUrlResponseSchema>
