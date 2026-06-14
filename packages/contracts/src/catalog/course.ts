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

/** POST /v1/courses/suggest — crowdsource a missing course (suggest_course RPC). */
export const suggestCourseBodySchema = z.object({
  code: z.string().trim().min(2).max(15),
  name: z.string().trim().min(2).max(120),
  department_id: z.string().uuid(),
})
export type SuggestCourseBody = z.infer<typeof suggestCourseBodySchema>

/** Mirrors the suggest_course jsonb: status + (course_id | suggestion_id). */
export const suggestCourseResultSchema = z.object({
  status: z.string(),
  course_id: z.string().nullable().optional(),
  suggestion_id: z.string().nullable().optional(),
})
export type SuggestCourseResult = z.infer<typeof suggestCourseResultSchema>
