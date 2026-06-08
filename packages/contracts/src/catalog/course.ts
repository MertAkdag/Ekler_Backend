import { z } from 'zod'

/**
 * Courses. The live DB has no department↔course link (the course_catalog
 * migration was never applied), so courses are scoped by the caller's
 * university_domain and ordered by code — matching what the RN
 * useCourseCatalog hook actually does today (id/code/name, code order).
 */
export const courseSchema = z.object({
  id: z.string(),
  code: z.string(),
  name: z.string(),
})
export type Course = z.infer<typeof courseSchema>

export const courseListQuerySchema = z.object({
  search: z.string().trim().min(1).optional(),
})
export type CourseListQuery = z.infer<typeof courseListQuerySchema>
