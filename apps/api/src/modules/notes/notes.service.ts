import { Inject, Injectable } from '@nestjs/common'
import { and, asc, desc, eq, sql } from 'drizzle-orm'
import type {
  CreateNoteBody,
  CreateNoteCommentBody,
  CreateNoteResult,
  ListEnvelope,
  NoteCommentRow,
  NoteCommentsQuery,
  NoteFeedQuery,
  NoteFeedRow,
  NoteVoteBody,
} from '@ekler/contracts'
import { DRIZZLE, type Db } from '../../db/drizzle.module'
import { ScopedRepository } from '../../db/scoped/scoped-repository'
import { courses, noteComments, noteVotes, notes, profiles, userSettings } from '../../db/schema'
import { encodeCursor } from '../../core/pagination/cursor'
import { AppError } from '../../core/errors/app-error'
import { StorageService } from '../storage/storage.service'
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
    private readonly storage: StorageService,
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

  /**
   * Cast / change / remove the caller's vote on a note (matches the RN castVote:
   * delete the old vote, then insert the new one if `direction` isn't null). The
   * notes.vote_score denorm is recomputed by the trg_sync_note_vote_score trigger —
   * a recount, so it's idempotent and safe. Anti-K-1: the note must be in the caller's
   * university (cross-uni vote → 404).
   */
  async vote(noteId: string, body: NoteVoteBody, user: AuthPrincipal): Promise<void> {
    this.scope.domain() // fail-closed
    const uid = user.userId

    const found = await this.db
      .select({ id: notes.id })
      .from(notes)
      .where(and(this.scope.scopeFilter(notes.universityDomain), sql`${notes.id} = ${noteId}::uuid`))
      .limit(1)
    if (found.length === 0) throw new AppError('NOT_FOUND', 'Not bulunamadı.')

    await this.db.transaction(async (tx) => {
      await tx
        .delete(noteVotes)
        .where(
          and(sql`${noteVotes.noteId} = ${noteId}::uuid`, sql`${noteVotes.userId} = ${uid}::uuid`),
        )
      if (body.direction) {
        await tx.insert(noteVotes).values({
          noteId,
          userId: uid,
          direction: body.direction,
        })
      }
    })
  }

  /** Create a note record (file already uploaded to storage; we store its key). */
  async create(input: CreateNoteBody, user: AuthPrincipal): Promise<CreateNoteResult> {
    const domain = this.scope.domain()
    await this.assertNotBanned(user.userId)
    const [row] = await this.db
      .insert(notes)
      .values({
        authorId: user.userId,
        uploaderId: user.userId,
        courseId: input.course_id,
        universityDomain: domain,
        title: input.title,
        description: input.description ?? null,
        fileUrl: input.file_url,
        fileType: input.file_type,
        fileSizeBytes: input.file_size_bytes ?? null,
      })
      .returning({ id: notes.id })
    if (!row) throw new AppError('INTERNAL', 'Not oluşturulamadı.')
    return { id: row.id }
  }

  /** Delete a note — author or admin only; cascades comments/votes, best-effort file cleanup. */
  async remove(noteId: string, user: AuthPrincipal): Promise<void> {
    const [row] = await this.db
      .select({ authorId: notes.authorId, fileUrl: notes.fileUrl })
      .from(notes)
      .where(and(this.scope.scopeFilter(notes.universityDomain), sql`${notes.id} = ${noteId}::uuid`))
      .limit(1)
    if (!row) throw new AppError('NOT_FOUND', 'Not bulunamadı.')
    if (row.authorId !== user.userId && !user.isAdmin) {
      throw new AppError('FORBIDDEN', 'Bu notu silme yetkin yok.')
    }

    await this.db
      .delete(notes)
      .where(and(this.scope.scopeFilter(notes.universityDomain), sql`${notes.id} = ${noteId}::uuid`))

    if (row.fileUrl && !row.fileUrl.includes('://') && this.storage.enabled) {
      try {
        await this.storage.deleteObject('notes', row.fileUrl)
      } catch {
        // best-effort file cleanup — never fail the delete on storage errors
      }
    }
  }

  /** Atomic +1 download counter (increment_note_download). Scoped to the caller's university. */
  async download(noteId: string, user: AuthPrincipal): Promise<void> {
    void user
    await this.requireInScope(noteId)
    await this.db.execute(sql`select public.increment_note_download(${noteId}::uuid)`)
  }

  /** Comments for a note — accountable (username shown), keyset ASC, scoped via the parent note. */
  async comments(
    noteId: string,
    q: NoteCommentsQuery,
    user: AuthPrincipal,
  ): Promise<ListEnvelope<NoteCommentRow>> {
    const uid = user.userId
    const where = [
      sql`${noteComments.noteId} = ${noteId}::uuid`,
      this.scope.scopeFilter(notes.universityDomain),
      q.cursor_created_at && q.cursor_id
        ? sql`(${noteComments.createdAt}, ${noteComments.id}) > (${q.cursor_created_at}::timestamptz, ${q.cursor_id}::uuid)`
        : undefined,
    ]

    const rows = await this.db
      .select({
        id: noteComments.id,
        body: noteComments.body,
        created_at: noteComments.createdAt,
        is_mine: sql<boolean>`${noteComments.userId} = ${uid}::uuid`,
        user_id: noteComments.userId,
        author_name: sql<string | null>`coalesce(${profiles.fullName}, ${profiles.username})`,
        author_username: profiles.username,
        author_avatar: profiles.avatarUrl,
      })
      .from(noteComments)
      .innerJoin(notes, eq(notes.id, noteComments.noteId))
      .leftJoin(profiles, eq(profiles.id, noteComments.userId))
      .where(and(...where))
      .orderBy(asc(noteComments.createdAt), asc(noteComments.id))
      .limit(q.limit)

    const hasMore = rows.length === q.limit
    const last = rows[rows.length - 1]
    const cursor =
      hasMore && last ? encodeCursor({ created_at: last.created_at as string, id: last.id }) : null
    return { data: rows as NoteCommentRow[], meta: { cursor, has_more: hasMore } }
  }

  /** Add a comment to a note (accountable). comment_count is maintained by a DB trigger. */
  async createComment(
    noteId: string,
    input: CreateNoteCommentBody,
    user: AuthPrincipal,
  ): Promise<NoteCommentRow> {
    await this.requireInScope(noteId)
    await this.assertNotBanned(user.userId)

    const [inserted] = await this.db
      .insert(noteComments)
      .values({ noteId, userId: user.userId, body: input.body })
      .returning({ id: noteComments.id, created_at: noteComments.createdAt })
    if (!inserted) throw new AppError('INTERNAL', 'Yorum oluşturulamadı.')

    const [author] = await this.db
      .select({
        full_name: profiles.fullName,
        username: profiles.username,
        avatar_url: profiles.avatarUrl,
      })
      .from(profiles)
      .where(eq(profiles.id, user.userId))
      .limit(1)

    return {
      id: inserted.id,
      body: input.body,
      created_at: inserted.created_at as string,
      is_mine: true,
      user_id: user.userId,
      author_name: author?.full_name ?? author?.username ?? null,
      author_username: author?.username ?? null,
      author_avatar: author?.avatar_url ?? null,
    }
  }

  /** Fail-closed 404 if the note isn't in the caller's university (anti-K-1). */
  private async requireInScope(noteId: string): Promise<void> {
    const [found] = await this.db
      .select({ id: notes.id })
      .from(notes)
      .where(and(this.scope.scopeFilter(notes.universityDomain), sql`${notes.id} = ${noteId}::uuid`))
      .limit(1)
    if (!found) throw new AppError('NOT_FOUND', 'Not bulunamadı.')
  }

  /** Ban/restriction gate for note writes. */
  private async assertNotBanned(uid: string): Promise<void> {
    const res = (await this.db.execute(
      sql`select public.is_user_banned(${uid}::uuid) as banned, public.is_user_restricted(${uid}::uuid) as restricted`,
    )) as unknown as { rows: Array<{ banned: boolean; restricted: boolean }> }
    const row = res.rows[0]
    if (row?.banned) throw new AppError('USER_BANNED', 'Hesabın askıya alındığı için işlem yapamıyorsun.')
    if (row?.restricted) throw new AppError('FORBIDDEN', 'Hesabın kısıtlı olduğu için işlem yapamıyorsun.')
  }
}
