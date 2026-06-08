import { z } from 'zod'
import { pageMetaSchema } from './pagination'

/**
 * Success response envelope.
 * - Single resource: `{ data }` (no meta).
 * - List: `{ data: [...], meta: { cursor, has_more } }`.
 */
export function dataEnvelope<T extends z.ZodTypeAny>(data: T) {
  return z.object({ data })
}

export function listEnvelope<T extends z.ZodTypeAny>(item: T) {
  return z.object({
    data: z.array(item),
    meta: pageMetaSchema,
  })
}

export type DataEnvelope<T> = { data: T }
export type ListEnvelope<T> = { data: T[]; meta: z.infer<typeof pageMetaSchema> }
