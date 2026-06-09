import { z } from 'zod'

/**
 * Polymorphic content reports. target_type is constrained by the DB CHECK to
 * confession / comment / user / note. One report per (target_type, target_id,
 * reporter) — a duplicate is a 409.
 */
export const reportTargetTypeSchema = z.enum(['confession', 'comment', 'user', 'note'])
export type ReportTargetType = z.infer<typeof reportTargetTypeSchema>

export const createReportBodySchema = z.object({
  target_type: reportTargetTypeSchema,
  target_id: z.string().uuid(),
  reason: z.string().trim().min(1).max(100),
  description: z.string().max(1000).nullable().default(null),
})
export type CreateReportBody = z.infer<typeof createReportBodySchema>
