import { z } from 'zod'

/**
 * The base profile — what AuthContext reads (contexts/AuthContext.tsx) and what
 * the auth flow returns. snake_case on the wire for zero client-side reshaping.
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

/**
 * GET /v1/me + PATCH /v1/me — the base profile plus the profile-SCREEN fields
 * (useProfileData). A superset of `profileSchema`, so AuthContext (which types
 * the response as `Profile`) keeps working while the profile screen gets its
 * extra fields. Extended fields are nullable — always present, possibly null.
 */
export const profileDetailSchema = profileSchema.extend({
  email: z.string().nullable(),
  university_name: z.string().nullable(),
  faculty_id: z.string().nullable(),
  department_id: z.string().nullable(),
  year_of_study: z.number().int().nullable(),
  bio: z.string().nullable(),
  study_style: z.string().nullable(),
  preferred_location: z.string().nullable(),
  xp_points: z.number().int().nullable(),
})
export type ProfileDetail = z.infer<typeof profileDetailSchema>

/** PATCH /v1/me — partial profile update (onboarding + profile edit). */
export const updateProfileBodySchema = z
  .object({
    full_name: z.string().min(1).max(120),
    username: z
      .string()
      .min(3)
      .max(20)
      .regex(/^[a-z0-9_]+$/, 'Yalnızca küçük harf, rakam ve alt çizgi.')
      .nullable(),
    bio: z.string().max(500).nullable(),
    avatar_url: z.string().nullable(),
    faculty: z.string().nullable(),
    department: z.string().nullable(),
    faculty_id: z.string().uuid().nullable(),
    department_id: z.string().uuid().nullable(),
    study_style: z.enum(['silent', 'discussion', 'music']).nullable(),
    preferred_location: z.string().nullable(),
    year_of_study: z.number().int().min(1).max(6).nullable(),
    university_name: z.string().nullable(),
  })
  .partial()
export type UpdateProfileBody = z.infer<typeof updateProfileBodySchema>

/** GET /v1/me/username-available?username=… */
export const usernameAvailableQuerySchema = z.object({
  username: z.string().min(1).max(20),
})
export type UsernameAvailableQuery = z.infer<typeof usernameAvailableQuerySchema>
export const usernameAvailableSchema = z.object({ available: z.boolean() })
export type UsernameAvailable = z.infer<typeof usernameAvailableSchema>

/** GET /v1/me/stats — profile header counts (camelCase mirrors RN `UserStats`). */
export const userStatsSchema = z.object({
  totalSessions: z.number().int(),
  joinedSessions: z.number().int(),
  activeCourses: z.number().int(),
})
export type UserStats = z.infer<typeof userStatsSchema>

/** GET /v1/me/courses — deduped enrolled courses (RN `UserCourse`). */
export const userCourseSchema = z.object({
  course_id: z.string(),
  code: z.string(),
  name: z.string(),
})
export type UserCourse = z.infer<typeof userCourseSchema>

/** POST /v1/me/courses — bulk enroll (upsert on user_id,course_id,semester). */
export const enrollCoursesBodySchema = z.object({
  courses: z
    .array(
      z.object({
        course_id: z.string().uuid(),
        semester: z.string().min(1).max(40),
        instructor: z.string().max(120).nullable().optional(),
      }),
    )
    .min(1)
    .max(50),
})
export type EnrollCoursesBody = z.infer<typeof enrollCoursesBodySchema>

/** GET/POST /v1/me/settings — the six synced settings (RN `UserSettings`). */
export const userSettingsSchema = z.object({
  theme_preference: z.enum(['system', 'light', 'dark']),
  notify_session_invites: z.boolean(),
  notify_session_reminders: z.boolean(),
  notify_new_sessions: z.boolean(),
  profile_visibility_enabled: z.boolean(),
  show_online_status: z.boolean(),
})
export type UserSettings = z.infer<typeof userSettingsSchema>
export const updateSettingsBodySchema = userSettingsSchema.partial()
export type UpdateSettingsBody = z.infer<typeof updateSettingsBodySchema>

/** POST /v1/me/presence — heartbeat (poll-on-focus replaces realtime). */
export const presenceBodySchema = z.object({ is_online: z.boolean() })
export type PresenceBody = z.infer<typeof presenceBodySchema>

/** POST /v1/me/device-tokens — register an Expo push token (delivery deferred). */
export const deviceTokenBodySchema = z.object({
  expo_push_token: z.string().min(1).max(255),
  platform: z.string().max(20).nullable().optional(),
})
export type DeviceTokenBody = z.infer<typeof deviceTokenBodySchema>
/** DELETE /v1/me/device-tokens — unregister this device (body since Expo tokens contain `[]`). */
export const deviceTokenDeleteBodySchema = z.object({
  expo_push_token: z.string().min(1).max(255),
})
export type DeviceTokenDeleteBody = z.infer<typeof deviceTokenDeleteBodySchema>

/** The KVKK/Apple-required consent types (server-driven; was hardcoded in RN). */
export const CONSENT_TYPES = [
  'kvkk',
  'privacy_policy',
  'terms_of_service',
  'notifications',
  'telemetry',
] as const
export const REQUIRED_CONSENT_TYPES = ['kvkk', 'privacy_policy', 'terms_of_service'] as const
export const CONSENT_VERSION = '1.0'

/** GET /v1/me/consents */
export const consentSchema = z.object({
  consent_type: z.string(),
  version: z.string(),
  granted: z.boolean(),
  granted_at: z.string(),
})
export type Consent = z.infer<typeof consentSchema>
/** GET /v1/me/required-consents */
export const requiredConsentsSchema = z.object({
  required: z.array(z.string()),
  version: z.string(),
})
export type RequiredConsents = z.infer<typeof requiredConsentsSchema>
/** POST /v1/me/consents — grant (defaults to the required set). */
export const grantConsentsBodySchema = z.object({
  consent_types: z.array(z.enum(CONSENT_TYPES)).min(1).optional(),
})
export type GrantConsentsBody = z.infer<typeof grantConsentsBodySchema>

/** PUT /v1/me/sister-universities — replace the caller's sister-university list. */
export const sisterUniversitiesBodySchema = z.object({
  domains: z.array(z.string().min(1).max(255)).max(50),
})
export type SisterUniversitiesBody = z.infer<typeof sisterUniversitiesBodySchema>
