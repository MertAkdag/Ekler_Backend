import { z } from 'zod'

/**
 * University catalog. Wire shapes mirror the existing Supabase RPCs
 * (get_university_with_sisters, get_faculties, get_departments) so the Node
 * endpoints are drop-in replacements — snake_case preserved.
 *
 * by-domain bundles faculties to kill the onboarding N+1 (the RN flow used to
 * call get_university_with_sisters then get_faculties separately).
 */
export const universitySchema = z.object({
  id: z.string(),
  name: z.string(),
  domain: z.string(),
  city_id: z.string(),
})

export const sisterUniversitySchema = z.object({
  name: z.string(),
  domain: z.string(),
})

export const facultySchema = z.object({
  id: z.string(),
  name: z.string(),
})

export const departmentSchema = z.object({
  id: z.string(),
  name: z.string(),
  faculty_id: z.string(),
  duration_years: z.number().int(),
  // per-university availability fields (null when querying the global fallback list)
  prep_mode: z.enum(['none', 'zorunlu', 'optional', 'sartli']).nullable().optional(),
  medium: z.enum(['tr', 'en', 'mixed']).nullable().optional(),
})

export const universityByDomainSchema = z.object({
  university: universitySchema.nullable(),
  sister_universities: z.array(sisterUniversitySchema),
  faculties: z.array(facultySchema),
})

export type University = z.infer<typeof universitySchema>
export type SisterUniversity = z.infer<typeof sisterUniversitySchema>
export type Faculty = z.infer<typeof facultySchema>
export type Department = z.infer<typeof departmentSchema>
export type UniversityByDomain = z.infer<typeof universityByDomainSchema>

export const byDomainQuerySchema = z.object({
  domain: z.string().trim().min(1),
})

/**
 * Optional domain scope for /faculties and /faculties/:id/departments.
 * When present, results are filtered to that university's availability
 * (university_departments). When absent, the global canonical list is returned
 * (back-compat / pre-import fallback so onboarding never hard-blocks).
 */
export const catalogScopeQuerySchema = z.object({
  domain: z.string().trim().min(1).optional(),
})
export type CatalogScopeQuery = z.infer<typeof catalogScopeQuerySchema>
