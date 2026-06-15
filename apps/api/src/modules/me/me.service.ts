import { Inject, Injectable } from '@nestjs/common'
import { and, desc, eq, inArray, sql } from 'drizzle-orm'
import type {
  Appeal,
  AppNotification,
  BlockedUser,
  Consent,
  CreateAppealBody,
  EnrollCoursesBody,
  IsBlockedResult,
  ProfileDetail,
  RequiredConsents,
  Sanction,
  UpdateProfileBody,
  UpdateSettingsBody,
  UserCourse,
  UserSettings,
  UserStats,
  VisibleUser,
} from '@ekler/contracts'
import { CONSENT_VERSION, REQUIRED_CONSENT_TYPES } from '@ekler/contracts'
import { DRIZZLE, type Db } from '../../db/drizzle.module'
import { AppError } from '../../core/errors/app-error'
import { StorageService } from '../storage/storage.service'
import type { AuthPrincipal } from '../../core/cls/cls-store'
import {
  confessionComments,
  confessions,
  courses,
  deviceTokens,
  moderationAppeals,
  notes,
  notifications,
  profiles,
  sessionParticipants,
  studySessions,
  userConsents,
  userCourses,
  userPresence,
  userSanctions,
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
  constructor(
    @Inject(DRIZZLE) private readonly db: Db,
    private readonly storage: StorageService,
  ) {}

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

  /** Presence heartbeat (poll-on-focus replaces the legacy realtime channel). */
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

  // ── Notifications inbox (READ surface; push DELIVERY is out of scope) ─────────

  async notifications(user: AuthPrincipal): Promise<AppNotification[]> {
    const rows = await this.db
      .select({
        id: notifications.id,
        type: notifications.type,
        title: notifications.title,
        body: notifications.body,
        data: notifications.data,
        is_read: notifications.isRead,
        created_at: notifications.createdAt,
      })
      .from(notifications)
      .where(eq(notifications.recipientId, user.userId))
      .orderBy(desc(notifications.createdAt))
      .limit(50)
    return rows as AppNotification[]
  }

  async markNotificationRead(id: string, user: AuthPrincipal): Promise<void> {
    await this.db
      .update(notifications)
      .set({ isRead: true })
      .where(and(eq(notifications.id, id), eq(notifications.recipientId, user.userId)))
  }

  async markAllNotificationsRead(user: AuthPrincipal): Promise<void> {
    await this.db
      .update(notifications)
      .set({ isRead: true })
      .where(and(eq(notifications.recipientId, user.userId), eq(notifications.isRead, false)))
  }

  async deleteNotification(id: string, user: AuthPrincipal): Promise<void> {
    await this.db
      .delete(notifications)
      .where(and(eq(notifications.id, id), eq(notifications.recipientId, user.userId)))
  }

  async clearNotifications(user: AuthPrincipal): Promise<void> {
    await this.db.delete(notifications).where(eq(notifications.recipientId, user.userId))
  }

  // ── Sanctions + appeals (quarantine screen) ──────────────────────────────────

  /** The caller's active ban/restriction (most recent), or null. */
  async activeSanction(user: AuthPrincipal): Promise<Sanction | null> {
    const [row] = await this.db
      .select({
        id: userSanctions.id,
        sanction_type: userSanctions.sanctionType,
        reason: userSanctions.reason,
        expires_at: userSanctions.expiresAt,
        is_active: userSanctions.isActive,
        created_at: userSanctions.createdAt,
      })
      .from(userSanctions)
      .where(
        and(
          eq(userSanctions.userId, user.userId),
          eq(userSanctions.isActive, true),
          inArray(userSanctions.sanctionType, ['temp_ban', 'permanent_ban']),
        ),
      )
      .orderBy(desc(userSanctions.createdAt))
      .limit(1)
    return (row as Sanction) ?? null
  }

  /** The caller's latest appeal (optionally for a specific sanction), or null. */
  async latestAppeal(user: AuthPrincipal, sanctionId?: string): Promise<Appeal | null> {
    const where = [eq(moderationAppeals.userId, user.userId)]
    if (sanctionId) where.push(eq(moderationAppeals.sanctionId, sanctionId))
    const [row] = await this.db
      .select({
        status: moderationAppeals.status,
        admin_response: moderationAppeals.adminResponse,
        created_at: moderationAppeals.createdAt,
      })
      .from(moderationAppeals)
      .where(and(...where))
      .orderBy(desc(moderationAppeals.createdAt))
      .limit(1)
    return (row as Appeal) ?? null
  }

  /** Submit a moderation appeal. A pending appeal blocks a new one. */
  async createAppeal(body: CreateAppealBody, user: AuthPrincipal): Promise<void> {
    const [pending] = await this.db
      .select({ id: moderationAppeals.id })
      .from(moderationAppeals)
      .where(and(eq(moderationAppeals.userId, user.userId), eq(moderationAppeals.status, 'pending')))
      .limit(1)
    if (pending) throw new AppError('CONFLICT', 'Halihazırda incelenen bir itirazın var.')

    await this.db.insert(moderationAppeals).values({
      userId: user.userId,
      appealType: body.appeal_type,
      relatedEntityType: body.related_entity_type,
      relatedEntityId: body.related_entity_id,
      sanctionId: body.sanction_id,
      reason: body.reason,
    })
  }

  // ── Visible users (bulk visibility + presence) ───────────────────────────────

  /**
   * Port of the get_visible_users RPC. The function reads auth.uid() for the viewer's
   * university scope, so we set the jwt-claims transaction-locally (same trick as the
   * confession create RPC) — reset at commit, never leaks across the pool.
   */
  async visibleUsers(idsCsv: string, user: AuthPrincipal): Promise<VisibleUser[]> {
    const ids = idsCsv
      .split(',')
      .map((s) => s.trim())
      .filter(Boolean)
    if (ids.length === 0) return []

    const claims = JSON.stringify({ sub: user.userId, role: 'authenticated' })
    return this.db.transaction(async (tx) => {
      await tx.execute(sql`select set_config('request.jwt.claims', ${claims}, true)`)
      const res = (await tx.execute(
        sql`select user_id, display_name, avatar_url, is_hidden, is_online, last_seen_at
            from public.get_visible_users(${ids}::uuid[])`,
      )) as unknown as { rows: VisibleUser[] }
      return res.rows
    })
  }

  // ── Blocks (UGC safety, Apple App Review 1.2) ────────────────────────────────
  // blocked_users is not in the Drizzle schema (it post-dates the 02 dump; added by
  // standalone 04-catalog-and-blocks.sql), so these use raw SQL.

  async blockUser(blockedId: string, reason: string | null, user: AuthPrincipal): Promise<void> {
    if (blockedId === user.userId) {
      throw new AppError('VALIDATION_FAILED', 'Kendini engelleyemezsin.')
    }
    try {
      await this.db.execute(
        sql`insert into public.blocked_users (blocker_id, blocked_id, reason)
            values (${user.userId}::uuid, ${blockedId}::uuid, ${reason ?? null})`,
      )
    } catch (err) {
      if (blockUniqueViolation(err)) return // already blocked → idempotent
      throw err
    }
  }

  async unblockUser(blockedId: string, user: AuthPrincipal): Promise<void> {
    await this.db.execute(
      sql`delete from public.blocked_users
          where blocker_id = ${user.userId}::uuid and blocked_id = ${blockedId}::uuid`,
    )
  }

  async listBlocked(user: AuthPrincipal): Promise<BlockedUser[]> {
    const res = (await this.db.execute(
      sql`select blocked_id, created_at, reason from public.blocked_users
          where blocker_id = ${user.userId}::uuid order by created_at desc`,
    )) as unknown as { rows: BlockedUser[] }
    return res.rows
  }

  async isBlocked(otherId: string, user: AuthPrincipal): Promise<IsBlockedResult> {
    const res = (await this.db.execute(
      sql`select public.is_blocked_between(${user.userId}::uuid, ${otherId}::uuid) as blocked`,
    )) as unknown as { rows: Array<{ blocked: boolean }> }
    return { blocked: res.rows[0]?.blocked ?? false }
  }

  // ── GDPR (Wave F) — replaces the delete-user / export-my-data edge functions ──

  /**
   * Delete the account. Collects storage keys first, then deletes the auth identity —
   * every owned row (profile, confessions, notes, comments, sessions, memberships,
   * settings, consents, sanctions, blocks, …) is wiped by FK onDelete cascade. Stored
   * files are then removed best-effort (a failed cleanup never fails the deletion).
   */
  async deleteAccount(user: AuthPrincipal): Promise<void> {
    const uid = user.userId
    const imgs = await this.db
      .select({ k: confessions.imageUrl })
      .from(confessions)
      .where(eq(confessions.authorId, uid))
    const files = await this.db
      .select({ k: notes.fileUrl })
      .from(notes)
      .where(eq(notes.authorId, uid))

    await this.db.execute(sql`delete from auth.users where id = ${uid}::uuid`)

    if (this.storage.enabled) {
      for (const r of imgs) {
        const key = gdprStorageKey(r.k)
        if (key) {
          try {
            await this.storage.deleteObject('confessions', key)
          } catch {
            /* best-effort */
          }
        }
      }
      for (const r of files) {
        const key = gdprStorageKey(r.k)
        if (key) {
          try {
            await this.storage.deleteObject('notes', key)
          } catch {
            /* best-effort */
          }
        }
      }
    }
  }

  /** Assemble the caller's data into a single JSON object (KVKK/GDPR data portability). */
  async exportData(user: AuthPrincipal): Promise<Record<string, unknown>> {
    const uid = user.userId
    const [
      profile,
      myConfessions,
      myComments,
      myNotes,
      mySessions,
      myCourses,
      settings,
      sanctions,
      appeals,
      consents,
    ] = await Promise.all([
      this.db.select().from(profiles).where(eq(profiles.id, uid)).limit(1),
      this.db.select().from(confessions).where(eq(confessions.authorId, uid)),
      this.db.select().from(confessionComments).where(eq(confessionComments.authorId, uid)),
      this.db.select().from(notes).where(eq(notes.authorId, uid)),
      this.db.select().from(studySessions).where(eq(studySessions.creatorId, uid)),
      this.db.select().from(userCourses).where(eq(userCourses.userId, uid)),
      this.db.select().from(userSettings).where(eq(userSettings.userId, uid)),
      this.db.select().from(userSanctions).where(eq(userSanctions.userId, uid)),
      this.db.select().from(moderationAppeals).where(eq(moderationAppeals.userId, uid)),
      this.db.select().from(userConsents).where(eq(userConsents.userId, uid)),
    ])

    const blocks = (await this.db.execute(
      sql`select blocked_id, reason, created_at from public.blocked_users where blocker_id = ${uid}::uuid`,
    )) as unknown as { rows: unknown[] }

    return {
      exported_at: new Date().toISOString(),
      user_id: uid,
      profile: profile[0] ?? null,
      confessions: myConfessions,
      confession_comments: myComments,
      notes: myNotes,
      study_sessions: mySessions,
      courses: myCourses,
      settings: settings[0] ?? null,
      sanctions,
      appeals,
      consents,
      blocked_users: blocks.rows,
    }
  }
}

/** True if the error is a Postgres unique-violation (drizzle wraps it on `.cause`). */
function blockUniqueViolation(err: unknown): boolean {
  const code =
    (err as { cause?: { code?: string } })?.cause?.code ?? (err as { code?: string })?.code
  return code === '23505'
}

/** A Node-stored object key (bare key), or null for none / legacy full URLs we can't map. */
function gdprStorageKey(value: string | null): string | null {
  if (!value || value.includes('://')) return null
  return value
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
