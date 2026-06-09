import { Inject, Injectable } from '@nestjs/common'
import { and, asc, eq, inArray, sql } from 'drizzle-orm'
import type { SessionFeedQuery, SessionFeedRow } from '@ekler/contracts'
import { DRIZZLE, type Db } from '../../db/drizzle.module'
import { ScopedRepository } from '../../db/scoped/scoped-repository'
import { courses, profiles, studySessions, userSettings } from '../../db/schema'
import type { AuthPrincipal } from '../../core/cls/cls-store'

/**
 * Study sessions feed — Drizzle port of the Supabase RPC `get_sessions_feed`.
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
}
