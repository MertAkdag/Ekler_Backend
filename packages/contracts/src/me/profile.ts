import { z } from 'zod'

/**
 * GET /v1/me — the authenticated user's profile.
 * snake_case on the wire to drop-in replace the RN `Profile` interface
 * (contexts/AuthContext.tsx) with zero client-side reshaping.
 */
export const profileSchema = z.object({
  id: z.string(),
  full_name: z.string().nullable(),
  username: z.string().nullable(),
  avatar_url: z.string().nullable(),
  university_domain: z.string(),
  faculty: z.string().nullable(),
  department: z.string().nullable(),
  is_admin: z.boolean(),
  is_banned: z.boolean(),
  is_restricted: z.boolean(),
  restriction_ends_at: z.string().nullable(),
})
export type Profile = z.infer<typeof profileSchema>
