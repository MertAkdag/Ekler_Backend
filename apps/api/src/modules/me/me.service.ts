import { Inject, Injectable } from '@nestjs/common'
import { and, eq, inArray, sql } from 'drizzle-orm'
import type {
  Consent,
  EnrollCoursesBody,
  ProfileDetail,
  RequiredConsents,
  UpdateProfileBody,
  UpdateSettingsBody,
  UserCourse,
  UserSettings,
  UserStats,
} from '@ekler/contracts'
import { CONSENT_VERSION, REQUIRED_CONSENT_TYPES } from '@ekler/contracts'
import { DRIZZLE, type Db } from '../../db/drizzle.module'
import { AppError } from '../../core/errors/app-error'
import type { AuthPrincipal } from '../../core/cls/cls-store'
import {
  courses,
  deviceTokens,
  profiles,
  sessionParticipants,
  studySessions,
  userConsents,
  userCourses,
  userPresence,
  userSettings,
  userSisterUniversities,
} from '../../db/schema'

/** Snake_case projection shared by GET /me and PATCH /me (serves both AuthContext + profile screen). */
const PROFILE_COLUMNS = {
  id: profiles.id,
  full_name: profiles.fullName,
  username: profiles.username,
  avatar_url: profiles.avatarUrl,
  university_domain: profiles.universityDomain,
  faculty: profiles.faculty,
  department: profiles.department,
  is_admin: profiles.isAdmin,
  is_banned: profiles.isBanned,
  is_restricted: profiles.isRestricted,
  restriction_ends_at: profiles.restrictionEndsAt,
  email: profiles.email,
  university_name: profiles.universityName,
  faculty_id: profiles.facultyId,
  department_id: profiles.departmentId,
  year_of_study: profiles.yearOfStudy,
  bio: profiles.bio,
  study_style: profiles.studyStyle,
  preferred_location: profiles.preferredLocation,
  xp_points: profiles.xpPoints,
} as const

/** Defaults mirror the user_settings column defaults (seeded on first read). */
const DEFAULT_SETTINGS: UserSettings = {
  theme_preference: 'system',
  notify_session_invites: true,
  notify_session_reminders: true,
  notify_new_sessions: true,
  profile_visibility_enabled: true,
  show_online_status: false,
}

const SETTINGS_COLUMNS = {
  theme_preference: userSettings.themePreference,
  notify_session_invites: userSettings.notifySessionInvites,
  notify_session_reminders: userSettings.notifySessionReminders,
  notify_new_sessions: userSettings.notifyNewSessions,
  profile_visibility_enabled: userSettings.profileVisibilityEnabled,
  show_online_status: userSettings.showOnlineStatus,
} as const

/** Maps a unique-violation on profiles.username → CONFLICT, re-throws otherwise. */
function rethrowUsernameConflict(err: unknown): never {
  const code =
    (err as { cause?: { code?: string } })?.cause?.code ?? (err as { code?: string })?.code
  if (code === '23505') throw new AppError('CONFLICT', 'Bu kullanıcı adı alınmış.')
  throw err
}

/**
 * The /me domain — everything keyed by the authenticated user (profile, courses,
 * settings, presence, device tokens, consents, sister universities). All rows are
 * user-owned, so authorization is a plain `user_id = caller` filter (no anti-K-1
 * ScopedRepository needed — that guards university_domain tables only).
 */
@Injectable()
export class MeService {
  constructor(@Inject(DRIZZLE) private readonly db: Db) {}

  /** The caller's full profile (base AuthContext fields + profile-screen fields). */
  async profile(user: AuthPrincipal): Promise<ProfileDetail> {
    const [row] = await this.db
      .select(PROFILE_COLUMNS)
      .from(profiles)
      .where(eq(profiles.id, user.userId))
      .limit(1)
    if (!row) throw new AppError('NOT_FOUND', 'Profil bulunamadı.')
    return row
  }

  /** Partial profile update; returns the refreshed profile. */
  async updateProfile(body: UpdateProfileBody, user: AuthPrincipal): Promise<ProfileDetail> {
    const patch: Record<string, unknown> = {}
    if (body.full_name !== undefined) patch.fullName = body.full_name
    if (body.username !== undefined) patch.username = body.username
    if (body.bio !== undefined) patch.bio = body.bio
    if (body.avatar_url !== undefined) patch.avatarUrl = body.avatar_url
    if (body.faculty !== undefined) patch.faculty = body.faculty
    if (body.department !== undefined) patch.department = body.department
    if (body.faculty_id !== undefined) patch.facultyId = body.faculty_id
    if (body.department_id !== undefined) patch.departmentId = body.department_id
    if (body.study_style !== undefined) patch.studyStyle = body.study_style
    if (body.preferred_location !== undefined) patch.preferredLocation = body.preferred_location
    if (body.year_of_study !== undefined) patch.yearOfStudy = body.year_of_study
    if (body.university_name !== undefined) patch.universityName = body.university_name

    if (Object.keys(patch).length > 0) {
      try {
        await this.db.update(profiles).set(patch).where(eq(profiles.id, user.userId))
      } catch (err) {
        rethrowUsernameConflict(err)
      }
    }
    return this.profile(user)
  }

  /** Username availability (case-sensitive match; the caller's own name counts as available). */
  async usernameAvailable(username: string, user: AuthPrincipal): Promise<{ available: boolean }> {
    const [row] = await this.db
      .select({ id: profiles.id })
      .from(profiles)
      .where(eq(profiles.username, username))
      .limit(1)
    return { available: !row || row.id === user.userId }
  }

  /** Profile header counts (sessions created, sessions joined, distinct enrolled courses). */
  async stats(user: AuthPrincipal): Promise<UserStats> {
    const uid = user.userId
    const [created] = await this.db
      .select({ n: sql<number>`count(*)::int` })
      .from(studySessions)
      .where(eq(studySessions.creatorId, uid))
    const [joined] = await this.db
      .select({ n: sql<number>`count(*)::int` })
      .from(sessionParticipants)
      .where(and(eq(sessionParticipants.userId, uid), eq(sessionParticipants.status, 'joined')))
    const [courseCount] = await this.db
      .select({ n: sql<number>`count(distinct ${userCourses.courseId})::int` })
      .from(userCourses)
      .where(eq(userCourses.userId, uid))
    return {
      totalSessions: created?.n ?? 0,
      joinedSessions: joined?.n ?? 0,
      activeCourses: courseCount?.n ?? 0,
    }
  }

  /** Enrolled courses, deduped by course_id (one row per course across semesters). */
  async courses(user: AuthPrincipal): Promise<UserCourse[]> {
    const rows = await this.db
      .select({ course_id: userCourses.courseId, code: courses.code, name: courses.name })
      .from(userCourses)
      .innerJoin(courses, eq(courses.id, userCourses.courseId))
      .where(eq(userCourses.userId, user.userId))

    const seen = new Set<string>()
    const out: UserCourse[] = []
    for (const r of rows) {
      if (seen.has(r.course_id)) continue
      seen.add(r.course_id)
      out.push(r)
    }
    return out
  }

  /** Bulk enroll — upsert on (user_id, course_id, semester); updates instructor on conflict. */
  async enrollCourses(body: EnrollCoursesBody, user: AuthPrincipal): Promise<void> {
    const values = body.courses.map((c) => ({
      userId: user.userId,
      courseId: c.course_id,
      semester: c.semester,
      instructor: c.instructor ?? null,
    }))
    await this.db
      .insert(userCourses)
      .values(values)
      .onConflictDoUpdate({
        target: [userCourses.userId, userCourses.courseId, userCourses.semester],
        set: { instructor: sql`excluded.instructor` },
      })
  }

  /** Drop a course from the caller's enrollment (all semesters). */
  async deleteCourse(courseId: string, user: AuthPrincipal): Promise<void> {
    await this.db
      .delete(userCourses)
      .where(and(eq(userCourses.userId, user.userId), eq(userCourses.courseId, courseId)))
  }

  /** Current settings; seeds the row with defaults on first read (mirrors RN seed-on-load). */
  async settings(user: AuthPrincipal): Promise<UserSettings> {
    const [row] = await this.db
      .select(SETTINGS_COLUMNS)
      .from(userSettings)
      .where(eq(userSettings.userId, user.userId))
      .limit(1)
    // theme_preference is a plain text column; the DB check constraint guarantees
    // it is one of the three enum values, so the cast is safe.
    if (row) return row as UserSettings

    await this.db
      .insert(userSettings)
      .values({ userId: user.userId, ...toSettingsColumns(DEFAULT_SETTINGS) })
      .onConflictDoNothing({ target: userSettings.userId })
    return DEFAULT_SETTINGS
  }

  /** Upsert a partial settings patch; returns the merged row. */
  async updateSettings(body: UpdateSettingsBody, user: AuthPrincipal): Promise<UserSettings> {
    const patch = toSettingsColumns(body)
    await this.db
      .insert(userSettings)
      .values({ userId: user.userId, ...toSettingsColumns(DEFAULT_SETTINGS), ...patch })
      .onConflictDoUpdate({
        target: userSettings.userId,
        set: { ...patch, updatedAt: sql`now()` },
      })
    return this.settings(user)
  }

  /** Presence heartbeat (poll-on-focus replaces the Supabase realtime channel). */
  async touchPresence(isOnline: boolean, user: AuthPrincipal): Promise<void> {
    await this.db
      .insert(userPresence)
      .values({ userId: user.userId, isOnline, lastSeenAt: sql`now()` })
      .onConflictDoUpdate({
        target: userPresence.userId,
        set: { isOnline, lastSeenAt: sql`now()`, updatedAt: sql`now()` },
      })
  }

  /** Register/refresh an Expo push token (push DELIVERY is deferred; storage only). */
  async registerDeviceToken(
    expoPushToken: string,
    platform: string | null | undefined,
    user: AuthPrincipal,
  ): Promise<void> {
    await this.db
      .insert(deviceTokens)
      .values({
        userId: user.userId,
        expoPushToken,
        platform: platform ?? null,
        lastSeenAt: sql`now()`,
      })
      .onConflictDoUpdate({
        target: [deviceTokens.userId, deviceTokens.expoPushToken],
        set: { platform: platform ?? null, lastSeenAt: sql`now()` },
      })
  }

  /** Unregister this device's token. */
  async deleteDeviceToken(expoPushToken: string, user: AuthPrincipal): Promise<void> {
    await this.db
      .delete(deviceTokens)
      .where(
        and(eq(deviceTokens.userId, user.userId), eq(deviceTokens.expoPushToken, expoPushToken)),
      )
  }

  /** The caller's granted consents. */
  async consents(user: AuthPrincipal): Promise<Consent[]> {
    return this.db
      .select({
        consent_type: userConsents.consentType,
        version: userConsents.version,
        granted: userConsents.granted,
        granted_at: userConsents.grantedAt,
      })
      .from(userConsents)
      .where(and(eq(userConsents.userId, user.userId), eq(userConsents.granted, true)))
  }

  /** Server-driven required consent set (was hardcoded in RN accountCompliance). */
  requiredConsents(): RequiredConsents {
    return { required: [...REQUIRED_CONSENT_TYPES], version: CONSENT_VERSION }
  }

  /**
   * Grant the given consent types (defaults to the required set); idempotent —
   * inserts only missing grants and stamps profiles.kvkk/privacy timestamps,
   * replacing RN `ensureRequiredConsents`.
   */
  async grantConsents(types: readonly string[] | undefined, user: AuthPrincipal): Promise<void> {
    const wanted = types && types.length > 0 ? [...new Set(types)] : [...REQUIRED_CONSENT_TYPES]

    const existing = await this.db
      .select({ t: userConsents.consentType })
      .from(userConsents)
      .where(
        and(
          eq(userConsents.userId, user.userId),
          eq(userConsents.granted, true),
          inArray(userConsents.consentType, wanted),
        ),
      )
    const have = new Set(existing.map((r) => r.t))
    const toInsert = wanted
      .filter((t) => !have.has(t))
      .map((consentType) => ({
        userId: user.userId,
        consentType,
        version: CONSENT_VERSION,
        granted: true,
      }))
    if (toInsert.length > 0) {
      await this.db.insert(userConsents).values(toInsert)
    }

    if (wanted.includes('kvkk') || wanted.includes('privacy_policy')) {
      await this.db
        .update(profiles)
        .set({ kvkkConsentAt: sql`now()`, privacyConsentAt: sql`now()` })
        .where(eq(profiles.id, user.userId))
    }
  }

  /** Replace the caller's sister-university list (delete-all + insert, atomic). */
  async replaceSisterUniversities(domains: string[], user: AuthPrincipal): Promise<void> {
    const unique = [...new Set(domains.map((d) => d.trim().toLowerCase()).filter(Boolean))]
    await this.db.transaction(async (tx) => {
      await tx.delete(userSisterUniversities).where(eq(userSisterUniversities.userId, user.userId))
      if (unique.length > 0) {
        await tx
          .insert(userSisterUniversities)
          .values(unique.map((universityDomain) => ({ userId: user.userId, universityDomain })))
          .onConflictDoNothing()
      }
    })
  }
}

/** snake_case settings → drizzle camelCase columns (only the provided keys). */
function toSettingsColumns(s: Partial<UserSettings>): Record<string, unknown> {
  const out: Record<string, unknown> = {}
  if (s.theme_preference !== undefined) out.themePreference = s.theme_preference
  if (s.notify_session_invites !== undefined) out.notifySessionInvites = s.notify_session_invites
  if (s.notify_session_reminders !== undefined)
    out.notifySessionReminders = s.notify_session_reminders
  if (s.notify_new_sessions !== undefined) out.notifyNewSessions = s.notify_new_sessions
  if (s.profile_visibility_enabled !== undefined)
    out.profileVisibilityEnabled = s.profile_visibility_enabled
  if (s.show_online_status !== undefined) out.showOnlineStatus = s.show_online_status
  return out
}
