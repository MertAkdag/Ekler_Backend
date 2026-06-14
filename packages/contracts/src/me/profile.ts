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

// ─── Cross-cutting (Wave E) ──────────────────────────────────────────────────

/** GET /v1/me/notifications — the in-app inbox (push DELIVERY is out of scope). */
export const appNotificationSchema = z.object({
  id: z.string(),
  type: z.string(),
  title: z.string(),
  body: z.string(),
  data: z.record(z.string(), z.unknown()).nullable(),
  is_read: z.boolean(),
  created_at: z.string(),
})
export type AppNotification = z.infer<typeof appNotificationSchema>

/** GET /v1/me/sanctions — the caller's active ban/restriction (quarantine screen). */
export const sanctionSchema = z.object({
  id: z.string(),
  sanction_type: z.string(),
  reason: z.string().nullable(),
  expires_at: z.string().nullable(),
  is_active: z.boolean(),
  created_at: z.string(),
})
export type Sanction = z.infer<typeof sanctionSchema>

/** GET /v1/me/appeals — the caller's latest moderation appeal. */
export const appealSchema = z.object({
  status: z.string(),
  admin_response: z.string().nullable(),
  created_at: z.string(),
})
export type Appeal = z.infer<typeof appealSchema>

/** POST /v1/me/appeals — submit a moderation appeal. */
export const createAppealBodySchema = z.object({
  appeal_type: z.enum(['sanction', 'content_removal', 'account_ban']).default('sanction'),
  related_entity_type: z.string().nullable().default(null),
  related_entity_id: z.string().uuid().nullable().default(null),
  sanction_id: z.string().uuid().nullable().default(null),
  reason: z.string().trim().min(10).max(2000),
})
export type CreateAppealBody = z.infer<typeof createAppealBodySchema>

/** GET /v1/me/visible-users?ids=a,b,c — bulk visibility + presence (get_visible_users). */
export const visibleUserSchema = z.object({
  user_id: z.string(),
  display_name: z.string(),
  avatar_url: z.string().nullable(),
  is_hidden: z.boolean(),
  is_online: z.boolean(),
  last_seen_at: z.string().nullable(),
})
export type VisibleUser = z.infer<typeof visibleUserSchema>
export const visibleUsersQuerySchema = z.object({
  ids: z.string().min(1), // comma-separated uuids
})
export type VisibleUsersQuery = z.infer<typeof visibleUsersQuerySchema>

/** POST /v1/me/blocks — block a user (Apple App Review 1.2 UGC safety). */
export const blockUserBodySchema = z.object({
  blocked_id: z.string().uuid(),
  reason: z.string().max(500).nullable().optional(),
})
export type BlockUserBody = z.infer<typeof blockUserBodySchema>
/** GET /v1/me/blocks — the caller's block list. */
export const blockedUserSchema = z.object({
  blocked_id: z.string(),
  created_at: z.string(),
  reason: z.string().nullable(),
})
export type BlockedUser = z.infer<typeof blockedUserSchema>
/** GET /v1/me/blocks/check?other=… — bidirectional block check (is_blocked_between). */
export const isBlockedQuerySchema = z.object({ other: z.string().uuid() })
export type IsBlockedQuery = z.infer<typeof isBlockedQuerySchema>
export const isBlockedResultSchema = z.object({ blocked: z.boolean() })
export type IsBlockedResult = z.infer<typeof isBlockedResultSchema>
