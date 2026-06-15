import { Inject, Injectable } from '@nestjs/common'
import { and, asc, eq, inArray, sql } from 'drizzle-orm'
import type {
  CreateSessionBody,
  CreateSessionResult,
  SessionFeedQuery,
  SessionFeedRow,
} from '@ekler/contracts'
import { DRIZZLE, type Db } from '../../db/drizzle.module'
import { ScopedRepository } from '../../db/scoped/scoped-repository'
import { courses, profiles, sessionParticipants, studySessions, userSettings } from '../../db/schema'
import { AppError } from '../../core/errors/app-error'
import type { AuthPrincipal } from '../../core/cls/cls-store'

/**
 * Study sessions feed — Drizzle port of the legacy RPC `get_sessions_feed`.
 *
 * Anti-K-1: the RPC carried no tenancy filter (RLS-only). The port adds the
 * university scope EXPLICITLY via ScopedRepository. Projection, course/creator
 * joins, creator-visibility CASE, has_joined (session_participants), the live-window
 * filters (status active/full, starts_at within 24h, ends_at in the future) and the
 * starts_at-asc sort mirror the RPC exactly.
 */
@Injectable()
export class SessionsService {
  constructor(
    @Inject(DRIZZLE) private readonly db: Db,
    private readonly scope: ScopedRepository,
  ) {}

  async feed(q: SessionFeedQuery, user: AuthPrincipal): Promise<SessionFeedRow[]> {
    const domain = this.scope.domain() // anti-K-1
    const uid = user.userId

    const creatorName = sql<string>`case
      when ${studySessions.creatorId} = ${uid}::uuid then coalesce(${profiles.fullName}, ${profiles.username}, 'Öğrenci')
      when coalesce(${userSettings.profileVisibilityEnabled}, true) then coalesce(${profiles.fullName}, ${profiles.username}, 'Öğrenci')
      else 'Anonim Öğrenci'
    end`
    const hasJoined = sql<boolean>`exists (
      select 1 from public.session_participants sp
      where sp.session_id = ${studySessions.id} and sp.user_id = ${uid}::uuid and sp.status = 'joined'
    )`

    const where = [
      this.scope.scopeFilter(studySessions.universityDomain),
      inArray(studySessions.status, ['active', 'full']),
      sql`${studySessions.startsAt} >= (now() - interval '24 hours')`,
      sql`${studySessions.endsAt} >= now()`,
      // my_courses: restrict to the caller's enrolled course ids (empty → no rows, like the RPC's any('{}'))
      q.filter === 'my_courses'
        ? q.course_ids.length > 0
          ? inArray(studySessions.courseId, q.course_ids)
          : sql`false`
        : undefined,
    ]

    const rows = await this.db
      .select({
        id: studySessions.id,
        creator_id: studySessions.creatorId,
        title: studySessions.title,
        description: studySessions.description,
        location_name: studySessions.locationName,
        location_lat: studySessions.locationLat,
        location_lng: studySessions.locationLng,
        starts_at: studySessions.startsAt,
        ends_at: studySessions.endsAt,
        max_participants: studySessions.maxParticipants,
        participant_count: studySessions.participantCount,
        status: studySessions.status,
        created_at: studySessions.createdAt,
        course_code: sql<string>`coalesce(${courses.code}, '—')`,
        course_name: sql<string>`coalesce(${courses.name}, 'Ders belirtilmemiş')`,
        creator_name: creatorName,
        has_joined: hasJoined,
      })
      .from(studySessions)
      .leftJoin(courses, eq(courses.id, studySessions.courseId))
      .leftJoin(profiles, eq(profiles.id, studySessions.creatorId))
      .leftJoin(userSettings, eq(userSettings.userId, studySessions.creatorId))
      .where(and(...where))
      .orderBy(asc(studySessions.startsAt))
      .limit(q.limit)

    return rows as SessionFeedRow[]
  }

  /**
   * Create a session + auto-join the creator, ATOMICALLY (the RN did a non-atomic
   * insert-then-manual-rollback; the transaction fixes it). university_domain is
   * stamped from the caller's scope (anti-K-1); the participant insert fires the
   * trg_session_participant_count trigger → participant_count = 1, status active.
   */
  async create(input: CreateSessionBody, user: AuthPrincipal): Promise<CreateSessionResult> {
    const domain = this.scope.domain()
    const uid = user.userId

    return this.db.transaction(async (tx) => {
      const inserted = await tx
        .insert(studySessions)
        .values({
          creatorId: uid,
          courseId: input.courseId,
          title: input.title,
          description: input.description,
          locationName: input.locationName,
          startsAt: input.startsAt,
          endsAt: input.endsAt,
          maxParticipants: input.maxParticipants,
          universityDomain: domain,
          status: 'active',
        })
        .returning({ id: studySessions.id })
      const id = inserted[0]?.id
      if (!id) throw new AppError('INTERNAL', 'Seans oluşturulamadı.')

      await tx.insert(sessionParticipants).values({ sessionId: id, userId: uid, status: 'joined' })
      return { id }
    })
  }

  /** Join a session (status 'joined'). Already-joined → 409. Cross-uni / unknown → 404. */
  async join(sessionId: string, user: AuthPrincipal): Promise<void> {
    await this.requireInScope(sessionId)
    const uid = user.userId
    try {
      await this.db
        .insert(sessionParticipants)
        .values({ sessionId, userId: uid, status: 'joined' })
    } catch (err) {
      // drizzle wraps the pg error; the SQLSTATE lives on `.cause`.
      const code =
        (err as { cause?: { code?: string } })?.cause?.code ?? (err as { code?: string })?.code
      if (code === '23505') {
        throw new AppError('CONFLICT', 'Bu seansa zaten katılmışsın.')
      }
      throw err
    }
  }

  /** Leave a session (idempotent). Cross-uni / unknown → 404. */
  async leave(sessionId: string, user: AuthPrincipal): Promise<void> {
    await this.requireInScope(sessionId)
    const uid = user.userId
    await this.db
      .delete(sessionParticipants)
      .where(
        and(
          sql`${sessionParticipants.sessionId} = ${sessionId}::uuid`,
          sql`${sessionParticipants.userId} = ${uid}::uuid`,
        ),
      )
  }

  /** End a session — creator-only policy (NOT_SESSION_CREATOR otherwise). */
  async end(sessionId: string, user: AuthPrincipal): Promise<void> {
    const uid = user.userId
    const ended = await this.db
      .update(studySessions)
      .set({ status: 'ended' })
      .where(
        and(
          this.scope.scopeFilter(studySessions.universityDomain),
          sql`${studySessions.id} = ${sessionId}::uuid`,
          sql`${studySessions.creatorId} = ${uid}::uuid`,
        ),
      )
      .returning({ id: studySessions.id })
    if (ended.length > 0) return

    // Distinguish "not creator" (in scope) from "not found" (out of scope / unknown).
    await this.requireInScope(sessionId)
    throw new AppError('NOT_SESSION_CREATOR', 'Bu seansı yalnızca oluşturan sonlandırabilir.')
  }

  /** Fail-closed 404 if the session isn't in the caller's university (anti-K-1). */
  private async requireInScope(sessionId: string): Promise<void> {
    const found = await this.db
      .select({ id: studySessions.id })
      .from(studySessions)
      .where(
        and(
          this.scope.scopeFilter(studySessions.universityDomain),
          sql`${studySessions.id} = ${sessionId}::uuid`,
        ),
      )
      .limit(1)
    if (found.length === 0) throw new AppError('NOT_FOUND', 'Seans bulunamadı.')
  }
}
