import { Inject, Injectable } from '@nestjs/common'
import { and, desc, eq, sql } from 'drizzle-orm'
import type { NoteFeedQuery, NoteFeedRow } from '@ekler/contracts'
import { DRIZZLE, type Db } from '../../db/drizzle.module'
import { ScopedRepository } from '../../db/scoped/scoped-repository'
import { courses, noteVotes, notes, profiles, userSettings } from '../../db/schema'
import type { AuthPrincipal } from '../../core/cls/cls-store'

/**
 * Notes feed — Drizzle port of the Supabase RPC `get_notes_feed`.
 *
 * The RPC carried NO tenancy filter (it leaned on RLS — a classic K-1 hotspot:
 * a SECURITY DEFINER feed that returns everything once RLS is gone). The port adds
 * the university scope EXPLICITLY via the ScopedRepository chokepoint. Everything
 * else (projection, course/author joins, author-visibility CASE, user_vote, sort)
 * mirrors the RPC exactly.
 */
@Injectable()
export class NotesService {
  constructor(
    @Inject(DRIZZLE) private readonly db: Db,
    private readonly scope: ScopedRepository,
  ) {}

  async feed(q: NoteFeedQuery, user: AuthPrincipal): Promise<NoteFeedRow[]> {
    const domain = this.scope.domain() // anti-K-1: RPC had no scope; we add it
    const uid = user.userId

    const authorName = sql<string>`case
      when ${notes.authorId} = ${uid}::uuid then coalesce(${profiles.fullName}, ${profiles.username}, 'Öğrenci')
      when coalesce(${userSettings.profileVisibilityEnabled}, true) then coalesce(${profiles.fullName}, ${profiles.username}, 'Öğrenci')
      else 'Anonim Öğrenci'
    end`

    const where = [
      this.scope.scopeFilter(notes.universityDomain),
      eq(notes.isFlagged, false),
      eq(notes.isHidden, false),
      q.course_id ? sql`${notes.courseId} = ${q.course_id}::uuid` : undefined,
    ]

    // popular → vote_score desc then recency; recent → recency. (RPC tiebreak is
    // created_at only; id desc is an extra deterministic tiebreak, harmless.)
    const orderBy =
      q.sort === 'popular'
        ? [desc(notes.voteScore), desc(notes.createdAt), desc(notes.id)]
        : [desc(notes.createdAt), desc(notes.id)]

    const rows = await this.db
      .select({
        id: notes.id,
        author_id: notes.authorId,
        course_id: notes.courseId,
        title: notes.title,
        description: notes.description,
        file_url: notes.fileUrl,
        file_type: notes.fileType,
        file_size_bytes: notes.fileSizeBytes,
        download_count: notes.downloadCount,
        vote_score: notes.voteScore,
        comment_count: notes.commentCount,
        created_at: notes.createdAt,
        is_flagged: notes.isFlagged,
        course_code: sql<string>`coalesce(${courses.code}, '—')`,
        course_name: sql<string>`coalesce(${courses.name}, 'Ders belirtilmemiş')`,
        author_name: authorName,
        user_vote: noteVotes.direction,
        is_mine: sql<boolean>`${notes.authorId} = ${uid}::uuid`,
      })
      .from(notes)
      .leftJoin(courses, eq(courses.id, notes.courseId))
      .leftJoin(profiles, eq(profiles.id, notes.authorId))
      .leftJoin(userSettings, eq(userSettings.userId, notes.authorId))
      .leftJoin(noteVotes, and(eq(noteVotes.noteId, notes.id), sql`${noteVotes.userId} = ${uid}::uuid`))
      .where(and(...where))
      .orderBy(...orderBy)
      .limit(q.limit)

    return rows as NoteFeedRow[]
  }
}
