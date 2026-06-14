import { Inject, Injectable } from '@nestjs/common'
import { and, asc, desc, eq, isNull, sql } from 'drizzle-orm'
import type {
  ConfessionCommentRow,
  ConfessionCommentsQuery,
  ConfessionFeedQuery,
  ConfessionFeedRow,
  CreateCommentBody,
  CreateCommentResult,
  CreateConfessionBody,
  CreateConfessionResult,
  ListEnvelope,
  PreviewSubmissionBody,
  PreviewSubmissionResult,
} from '@ekler/contracts'
import { DRIZZLE, type Db } from '../../db/drizzle.module'
import { ScopedRepository } from '../../db/scoped/scoped-repository'
import {
  confessionBookmarks,
  confessionComments,
  confessionLikes,
  confessions,
  profiles,
  userSettings,
} from '../../db/schema'
import { encodeCursor } from '../../core/pagination/cursor'
import { AppError } from '../../core/errors/app-error'
import { StorageService } from '../storage/storage.service'
import type { AuthPrincipal } from '../../core/cls/cls-store'

/**
 * Kürsü read feed — a Drizzle port of the Supabase RPC `get_confessions_feed_v2`.
 *
 * The port is byte-for-byte faithful to the RPC's projection, filters, author-
 * visibility CASE, trending hot-score and `(created_at, id)` keyset — with ONE
 * deliberate change that is the whole point of the migration: tenancy is no longer
 * derived from `auth.uid()` (null outside RLS — the K-1 hotspot). It comes from the
 * CLS principal via the ScopedRepository chokepoint and is AND-injected explicitly.
 */
@Injectable()
export class ConfessionsService {
  constructor(
    @Inject(DRIZZLE) private readonly db: Db,
    private readonly scope: ScopedRepository,
    private readonly storage: StorageService,
  ) {}

  async feed(
    q: ConfessionFeedQuery,
    user: AuthPrincipal,
  ): Promise<ListEnvelope<ConfessionFeedRow>> {
    const domain = this.scope.domain() // fail-closed (anti-K-1)
    const uid = user.userId
    const empty: ListEnvelope<ConfessionFeedRow> = {
      data: [],
      meta: { cursor: null, has_more: false },
    }

    // RPC's `viewer` CTE excludes restricted users → empty feed. is_user_restricted
    // is self-healing (source of truth), so call it rather than the CLS snapshot.
    const restricted = await this.db.execute(
      sql`select public.is_user_restricted(${uid}::uuid) as restricted`,
    )
    if ((restricted as unknown as { rows: Array<{ restricted: boolean }> }).rows[0]?.restricted) {
      return empty
    }

    const isMine = sql<boolean>`${confessions.authorId} = ${uid}::uuid`
    const hasLiked = sql<boolean>`exists (
      select 1 from public.confession_likes cl
      where cl.confession_id = ${confessions.id} and cl.user_id = ${uid}::uuid
    )`
    const hasBookmarked = sql<boolean>`exists (
      select 1 from public.confession_bookmarks cb
      where cb.confession_id = ${confessions.id} and cb.user_id = ${uid}::uuid
    )`
    // Author display honours anonymity, ownership, and the author's visibility setting.
    const authorName = sql<string>`case
      when ${confessions.isAnonymous} then 'Anonim Öğrenci'
      when ${confessions.authorId} = ${uid}::uuid then coalesce(${profiles.fullName}, ${profiles.username}, 'Öğrenci')
      when coalesce(${userSettings.profileVisibilityEnabled}, true) then coalesce(${profiles.fullName}, ${profiles.username}, 'Öğrenci')
      else 'Anonim Öğrenci'
    end`
    const authorUsername = sql<string | null>`case
      when ${confessions.isAnonymous} then null
      when ${confessions.authorId} = ${uid}::uuid then ${profiles.username}
      when coalesce(${userSettings.profileVisibilityEnabled}, true) then ${profiles.username}
      else null
    end`
    const authorAvatar = sql<string | null>`case
      when ${confessions.isAnonymous} then null
      when ${confessions.authorId} = ${uid}::uuid then ${profiles.avatarUrl}
      when coalesce(${userSettings.profileVisibilityEnabled}, true) then ${profiles.avatarUrl}
      else null
    end`
    const hotScore = sql`case
      when ${confessions.createdAt} >= now() - interval '48 hours'
        then ((${confessions.likeCount} * 4) + (${confessions.commentCount} * 2))::numeric
          / greatest((extract(epoch from (now() - ${confessions.createdAt})) / 3600) + 2, 1)
      else -1::numeric
    end`

    const where = [
      this.scope.scopeFilter(confessions.universityDomain),
      isNull(confessions.hiddenAt),
      eq(confessions.moderationStatus, 'published'),
      eq(confessions.isFlagged, false),
      // category filter (`all`/`bookmarks` don't constrain category)
      q.filter !== 'all' && q.filter !== 'bookmarks'
        ? eq(confessions.category, q.filter)
        : undefined,
      // bookmarks-only filter
      q.filter === 'bookmarks'
        ? sql`exists (
            select 1 from public.confession_bookmarks cb2
            where cb2.confession_id = ${confessions.id} and cb2.user_id = ${uid}::uuid
          )`
        : undefined,
      // keyset cursor: (created_at, id) < (cursor_created_at, cursor_id)
      q.cursor_created_at && q.cursor_id
        ? sql`(${confessions.createdAt}, ${confessions.id}) < (${q.cursor_created_at}::timestamptz, ${q.cursor_id}::uuid)`
        : undefined,
    ]

    const orderBy =
      q.sort === 'trending'
        ? [desc(hotScore), desc(confessions.createdAt), desc(confessions.id)]
        : [desc(confessions.createdAt), desc(confessions.id)]

    const rows = await this.db
      .select({
        id: confessions.id,
        body: confessions.body,
        category: confessions.category,
        image_url: confessions.imageUrl,
        is_anonymous: confessions.isAnonymous,
        like_count: confessions.likeCount,
        comment_count: confessions.commentCount,
        is_flagged: confessions.isFlagged,
        created_at: confessions.createdAt,
        is_mine: isMine,
        has_liked: hasLiked,
        has_bookmarked: hasBookmarked,
        author_name: authorName,
        author_username: authorUsername,
        author_avatar: authorAvatar,
      })
      .from(confessions)
      .leftJoin(profiles, eq(profiles.id, confessions.authorId))
      .leftJoin(userSettings, eq(userSettings.userId, confessions.authorId))
      .where(and(...where))
      .orderBy(...orderBy)
      .limit(q.limit)

    const hasMore = rows.length === q.limit
    const last = rows[rows.length - 1]
    const cursor =
      hasMore && last ? encodeCursor({ created_at: last.created_at, id: last.id }) : null

    return { data: rows, meta: { cursor, has_more: hasMore } }
  }

  /**
   * Create a confession.
   *
   * The moderation engine (evaluate_moderation_rules + normalize/scan-log/enqueue) is
   * correctness- and Apple-review-critical and stays in the DB. Until the 1000-row
   * moderation snapshot gate exists to safely re-implement the orchestration, we call
   * the proven create_confession_v2 RPC inside a Node transaction — zero moderation
   * drift, atomic, and the API surface still moves to Node. auth.uid() is supplied via
   * a TRANSACTION-LOCAL jwt-claims setting (reset at commit, never leaks across the pool).
   *
   * `blocked`/`needs_review`/`published` come back as the RPC's jsonb. Only the
   * validation / ban / rate-limit paths raise (P0001); those map to canonical codes.
   */
  async create(
    input: CreateConfessionBody,
    user: AuthPrincipal,
  ): Promise<CreateConfessionResult> {
    const claims = JSON.stringify({ sub: user.userId, role: 'authenticated' })
    try {
      return await this.db.transaction(async (tx) => {
        await tx.execute(sql`select set_config('request.jwt.claims', ${claims}, true)`)
        const res = (await tx.execute(
          sql`select public.create_confession_v2(${input.body}, ${input.category}, ${input.isAnonymous}, ${input.imagePath}) as result`,
        )) as unknown as { rows: Array<{ result: CreateConfessionResult }> }
        const row = res.rows[0]
        if (!row) throw new AppError('INTERNAL', 'Gönderi oluşturulamadı.')
        return row.result
      })
    } catch (err) {
      throw this.mapWriteError(err)
    }
  }

  /**
   * Comment list for a confession — Drizzle port of get_confession_comments_v2.
   * Scoped via the PARENT confession (confession_comments has no university_domain):
   * the inner join + scopeFilter(confessions.universityDomain) makes a cross-uni or
   * non-existent confession id return an empty page (anti-K-1). Keyset ASC by (created_at, id).
   */
  async comments(
    confessionId: string,
    q: ConfessionCommentsQuery,
    user: AuthPrincipal,
  ): Promise<ListEnvelope<ConfessionCommentRow>> {
    const domain = this.scope.domain()
    const uid = user.userId
    const empty: ListEnvelope<ConfessionCommentRow> = {
      data: [],
      meta: { cursor: null, has_more: false },
    }

    const restricted = await this.db.execute(
      sql`select public.is_user_restricted(${uid}::uuid) as restricted`,
    )
    if ((restricted as unknown as { rows: Array<{ restricted: boolean }> }).rows[0]?.restricted) {
      return empty
    }

    const authorName = sql<string>`case
      when ${confessionComments.isAnonymous} then 'Anonim Öğrenci'
      when ${confessionComments.authorId} = ${uid}::uuid then coalesce(${profiles.fullName}, ${profiles.username}, 'Öğrenci')
      when coalesce(${userSettings.profileVisibilityEnabled}, true) then coalesce(${profiles.fullName}, ${profiles.username}, 'Öğrenci')
      else 'Anonim Öğrenci'
    end`
    const authorUsername = sql<string | null>`case
      when ${confessionComments.isAnonymous} then null
      when ${confessionComments.authorId} = ${uid}::uuid then ${profiles.username}
      when coalesce(${userSettings.profileVisibilityEnabled}, true) then ${profiles.username}
      else null
    end`
    const authorAvatar = sql<string | null>`case
      when ${confessionComments.isAnonymous} then null
      when ${confessionComments.authorId} = ${uid}::uuid then ${profiles.avatarUrl}
      when coalesce(${userSettings.profileVisibilityEnabled}, true) then ${profiles.avatarUrl}
      else null
    end`

    const where = [
      sql`${confessionComments.confessionId} = ${confessionId}::uuid`,
      this.scope.scopeFilter(confessions.universityDomain),
      isNull(confessions.hiddenAt),
      eq(confessions.moderationStatus, 'published'),
      isNull(confessionComments.hiddenAt),
      eq(confessionComments.moderationStatus, 'published'),
      eq(confessionComments.isFlagged, false),
      q.cursor_created_at && q.cursor_id
        ? sql`(${confessionComments.createdAt}, ${confessionComments.id}) > (${q.cursor_created_at}::timestamptz, ${q.cursor_id}::uuid)`
        : undefined,
    ]

    const rows = await this.db
      .select({
        id: confessionComments.id,
        body: confessionComments.body,
        is_anonymous: confessionComments.isAnonymous,
        created_at: confessionComments.createdAt,
        is_mine: sql<boolean>`${confessionComments.authorId} = ${uid}::uuid`,
        reply_to: confessionComments.replyTo,
        author_name: authorName,
        author_username: authorUsername,
        author_avatar: authorAvatar,
      })
      .from(confessionComments)
      .innerJoin(confessions, eq(confessions.id, confessionComments.confessionId))
      .leftJoin(profiles, eq(profiles.id, confessionComments.authorId))
      .leftJoin(userSettings, eq(userSettings.userId, confessionComments.authorId))
      .where(and(...where))
      .orderBy(asc(confessionComments.createdAt), asc(confessionComments.id))
      .limit(q.limit)

    const hasMore = rows.length === q.limit
    const last = rows[rows.length - 1]
    const cursor =
      hasMore && last ? encodeCursor({ created_at: last.created_at, id: last.id }) : null

    return { data: rows as ConfessionCommentRow[], meta: { cursor, has_more: hasMore } }
  }

  /**
   * Create a comment — same wrap-the-RPC strategy as create() (moderation stays in DB).
   * create_confession_comment_v2 also scopes the parent confession to the caller's
   * university_domain, so cross-uni comment attempts raise "Gönderi bulunamadı".
   */
  async createComment(
    confessionId: string,
    input: CreateCommentBody,
    user: AuthPrincipal,
  ): Promise<CreateCommentResult> {
    const claims = JSON.stringify({ sub: user.userId, role: 'authenticated' })
    try {
      return await this.db.transaction(async (tx) => {
        await tx.execute(sql`select set_config('request.jwt.claims', ${claims}, true)`)
        const res = (await tx.execute(
          sql`select public.create_confession_comment_v2(${confessionId}::uuid, ${input.body}, ${input.isAnonymous}, ${input.replyTo}) as result`,
        )) as unknown as { rows: Array<{ result: CreateCommentResult }> }
        const row = res.rows[0]
        if (!row) throw new AppError('INTERNAL', 'Yorum oluşturulamadı.')
        return row.result
      })
    } catch (err) {
      throw this.mapWriteError(err)
    }
  }

  /**
   * Single confession with the viewer's like/bookmark/mine state + author display —
   * the same projection as one feed row, scoped to the caller's university (anti-K-1).
   * Returns the EXACT ConfessionFeedRow shape so the RN detail path maps it like a feed row.
   */
  async detail(confessionId: string, user: AuthPrincipal): Promise<ConfessionFeedRow> {
    const domain = this.scope.domain()
    const uid = user.userId

    const isMine = sql<boolean>`${confessions.authorId} = ${uid}::uuid`
    const hasLiked = sql<boolean>`exists (
      select 1 from public.confession_likes cl
      where cl.confession_id = ${confessions.id} and cl.user_id = ${uid}::uuid
    )`
    const hasBookmarked = sql<boolean>`exists (
      select 1 from public.confession_bookmarks cb
      where cb.confession_id = ${confessions.id} and cb.user_id = ${uid}::uuid
    )`
    const authorName = sql<string>`case
      when ${confessions.isAnonymous} then 'Anonim Öğrenci'
      when ${confessions.authorId} = ${uid}::uuid then coalesce(${profiles.fullName}, ${profiles.username}, 'Öğrenci')
      when coalesce(${userSettings.profileVisibilityEnabled}, true) then coalesce(${profiles.fullName}, ${profiles.username}, 'Öğrenci')
      else 'Anonim Öğrenci'
    end`
    const authorUsername = sql<string | null>`case
      when ${confessions.isAnonymous} then null
      when ${confessions.authorId} = ${uid}::uuid then ${profiles.username}
      when coalesce(${userSettings.profileVisibilityEnabled}, true) then ${profiles.username}
      else null
    end`
    const authorAvatar = sql<string | null>`case
      when ${confessions.isAnonymous} then null
      when ${confessions.authorId} = ${uid}::uuid then ${profiles.avatarUrl}
      when coalesce(${userSettings.profileVisibilityEnabled}, true) then ${profiles.avatarUrl}
      else null
    end`

    const [row] = await this.db
      .select({
        id: confessions.id,
        body: confessions.body,
        category: confessions.category,
        image_url: confessions.imageUrl,
        is_anonymous: confessions.isAnonymous,
        like_count: confessions.likeCount,
        comment_count: confessions.commentCount,
        is_flagged: confessions.isFlagged,
        created_at: confessions.createdAt,
        is_mine: isMine,
        has_liked: hasLiked,
        has_bookmarked: hasBookmarked,
        author_name: authorName,
        author_username: authorUsername,
        author_avatar: authorAvatar,
      })
      .from(confessions)
      .leftJoin(profiles, eq(profiles.id, confessions.authorId))
      .leftJoin(userSettings, eq(userSettings.userId, confessions.authorId))
      .where(
        and(
          this.scope.scopeFilter(confessions.universityDomain),
          sql`${confessions.id} = ${confessionId}::uuid`,
          isNull(confessions.hiddenAt),
          eq(confessions.moderationStatus, 'published'),
        ),
      )
      .limit(1)

    if (!row) throw new AppError('NOT_FOUND', 'Gönderi bulunamadı.')
    return row as ConfessionFeedRow
  }

  /** Like a confession (idempotent). like_count is maintained by a DB trigger. */
  async like(confessionId: string, user: AuthPrincipal): Promise<void> {
    await this.requireInScope(confessionId)
    await this.assertCanReact(user.userId)
    try {
      await this.db
        .insert(confessionLikes)
        .values({ confessionId, userId: user.userId })
    } catch (err) {
      if (uniqueViolation(err)) return // already liked → idempotent
      throw err
    }
  }

  /** Remove a like (idempotent). */
  async unlike(confessionId: string, user: AuthPrincipal): Promise<void> {
    await this.requireInScope(confessionId)
    await this.db
      .delete(confessionLikes)
      .where(
        and(
          eq(confessionLikes.confessionId, confessionId),
          eq(confessionLikes.userId, user.userId),
        ),
      )
  }

  /** Bookmark a confession (idempotent). */
  async bookmark(confessionId: string, user: AuthPrincipal): Promise<void> {
    await this.requireInScope(confessionId)
    try {
      await this.db
        .insert(confessionBookmarks)
        .values({ confessionId, userId: user.userId })
    } catch (err) {
      if (uniqueViolation(err)) return
      throw err
    }
  }

  /** Remove a bookmark (idempotent). */
  async unbookmark(confessionId: string, user: AuthPrincipal): Promise<void> {
    await this.requireInScope(confessionId)
    await this.db
      .delete(confessionBookmarks)
      .where(
        and(
          eq(confessionBookmarks.confessionId, confessionId),
          eq(confessionBookmarks.userId, user.userId),
        ),
      )
  }

  /**
   * Delete a confession — author or admin only (the RLS `confessions_delete_admin`
   * policy ported to app code). Cascades to likes/bookmarks/comments via FK; the
   * stored image is removed best-effort afterwards (a failed cleanup never fails the
   * delete). Scoped to the caller's university (cross-uni id → 404).
   */
  async remove(confessionId: string, user: AuthPrincipal): Promise<void> {
    const [row] = await this.db
      .select({ authorId: confessions.authorId, imageUrl: confessions.imageUrl })
      .from(confessions)
      .where(
        and(
          this.scope.scopeFilter(confessions.universityDomain),
          sql`${confessions.id} = ${confessionId}::uuid`,
        ),
      )
      .limit(1)

    if (!row) throw new AppError('NOT_FOUND', 'Gönderi bulunamadı.')
    if (row.authorId !== user.userId && !user.isAdmin) {
      throw new AppError('FORBIDDEN', 'Bu gönderiyi silme yetkin yok.')
    }

    await this.db
      .delete(confessions)
      .where(
        and(
          this.scope.scopeFilter(confessions.universityDomain),
          sql`${confessions.id} = ${confessionId}::uuid`,
        ),
      )

    const key = storageKeyOf(row.imageUrl)
    if (key && this.storage.enabled) {
      try {
        await this.storage.deleteObject('confessions', key)
      } catch {
        // best-effort image cleanup — never fail the delete on storage errors
      }
    }
  }

  /**
   * Pre-flight moderation signal (preview_kursu_submission) gated by the server-
   * moderation rollout. Rollout off → always "allow" (the client falls back to the
   * create-time decision). Mirrors the RN `previewKursuSubmission` contract.
   */
  async preview(
    input: PreviewSubmissionBody,
    user: AuthPrincipal,
  ): Promise<PreviewSubmissionResult> {
    const enabled = (await this.db.execute(
      sql`select public.is_kursu_server_moderation_enabled(${user.userId}::uuid) as enabled`,
    )) as unknown as { rows: Array<{ enabled: boolean }> }
    if (!enabled.rows[0]?.enabled) {
      return { decision: 'allow', moderation_label: null, matched_categories: [], rollout_enabled: false }
    }

    const res = (await this.db.execute(
      sql`select public.preview_kursu_submission(${input.scope}, ${input.body}) as result`,
    )) as unknown as {
      rows: Array<{
        result: { decision?: string; moderation_label?: string | null; matched_categories?: string[] }
      }>
    }
    const r = res.rows[0]?.result ?? {}
    return {
      decision: r.decision ?? 'allow',
      moderation_label: r.moderation_label ?? null,
      matched_categories: Array.isArray(r.matched_categories) ? r.matched_categories : [],
      rollout_enabled: true,
    }
  }

  /** Fail-closed 404 if the confession isn't in the caller's university (anti-K-1). */
  private async requireInScope(confessionId: string): Promise<void> {
    const [found] = await this.db
      .select({ id: confessions.id })
      .from(confessions)
      .where(
        and(
          this.scope.scopeFilter(confessions.universityDomain),
          sql`${confessions.id} = ${confessionId}::uuid`,
        ),
      )
      .limit(1)
    if (!found) throw new AppError('NOT_FOUND', 'Gönderi bulunamadı.')
  }

  /** Ban/restriction gate for reactions (ported from the RLS like-insert policies). */
  private async assertCanReact(uid: string): Promise<void> {
    const res = (await this.db.execute(
      sql`select public.is_user_banned(${uid}::uuid) as banned, public.is_user_restricted(${uid}::uuid) as restricted`,
    )) as unknown as { rows: Array<{ banned: boolean; restricted: boolean }> }
    const row = res.rows[0]
    if (row?.banned) throw new AppError('USER_BANNED', 'Hesabın askıya alındığı için işlem yapamıyorsun.')
    if (row?.restricted) throw new AppError('FORBIDDEN', 'Hesabın kısıtlı olduğu için işlem yapamıyorsun.')
  }

  /** Map create_confession_v2 / _comment_v2 P0001 exceptions to canonical error codes. */
  private mapWriteError(err: unknown): AppError {
    if (err instanceof AppError) return err
    // drizzle wraps the pg error; the RPC's raised message lives on `.cause`.
    const cause = (err as { cause?: { message?: string } })?.cause
    const message = cause?.message ?? (err as { message?: string })?.message ?? ''
    if (message.includes('Çok hızlı')) {
      return new AppError('RATE_LIMIT_EXCEEDED', 'Çok hızlı gönderim — lütfen biraz bekleyin.')
    }
    if (message.includes('yapamıyor')) {
      return new AppError('USER_BANNED', message)
    }
    if (message.includes('bulunamadı')) {
      return new AppError('NOT_FOUND', message)
    }
    if (
      message.includes('500 karakter') ||
      message.includes('300 karakter') ||
      message.includes('Geçersiz kategori') ||
      message.includes('Bir şeyler yaz') ||
      message.includes('boş olamaz')
    ) {
      return new AppError('VALIDATION_FAILED', message)
    }
    return new AppError('INTERNAL', 'İşlem tamamlanamadı.')
  }
}

/** True if the error is a Postgres unique-violation (drizzle wraps it on `.cause`). */
function uniqueViolation(err: unknown): boolean {
  const code =
    (err as { cause?: { code?: string } })?.cause?.code ?? (err as { code?: string })?.code
  return code === '23505'
}

/**
 * Resolve a confession's stored image to an S3 object key, or null if none / not a
 * Node-stored key. Node-created confessions store the bare object key in image_url;
 * a legacy full URL (Supabase) can't be mapped to our bucket, so we skip cleanup.
 */
function storageKeyOf(imageUrl: string | null): string | null {
  if (!imageUrl) return null
  if (imageUrl.includes('://')) return null
  return imageUrl
}
