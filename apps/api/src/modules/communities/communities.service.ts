import { Inject, Injectable } from '@nestjs/common'
import { and, asc, desc, eq, sql } from 'drizzle-orm'
import type {
  CommunityEventRow,
  CommunityFeedQuery,
  CommunityFeedRow,
  CommunityMemberRow,
  CommunityPostRow,
  CreateCommunityBody,
  CreateCommunityEventBody,
  CreateCommunityPostBody,
  CreateCommunityResult,
  JoinCommunityResult,
  MemberActionBody,
} from '@ekler/contracts'
import { DRIZZLE, type Db } from '../../db/drizzle.module'
import { ScopedRepository } from '../../db/scoped/scoped-repository'
import {
  communities,
  communityEvents,
  communityMembers,
  communityPosts,
  profiles,
  userSettings,
} from '../../db/schema'
import { AppError } from '../../core/errors/app-error'
import type { AuthPrincipal } from '../../core/cls/cls-store'

type Membership = { role: string; status: string }

/**
 * Communities feed — Drizzle port of the RN direct `communities` read.
 *
 * Anti-K-1: the RN leaned on RLS for university tenancy; the port adds it explicitly
 * via ScopedRepository.scopeFilter(communities.universityDomain). The caller's
 * membership (user_role / user_status) is resolved with a single LEFT JOIN to
 * community_members instead of the RN's second query + JS merge. No order/limit
 * (the screen loads the full list and filters the my/explore tab client-side).
 */
@Injectable()
export class CommunitiesService {
  constructor(
    @Inject(DRIZZLE) private readonly db: Db,
    private readonly scope: ScopedRepository,
  ) {}

  async feed(q: CommunityFeedQuery, user: AuthPrincipal): Promise<CommunityFeedRow[]> {
    const domain = this.scope.domain() // anti-K-1
    const uid = user.userId

    const where = [
      this.scope.scopeFilter(communities.universityDomain),
      q.category ? eq(communities.category, q.category) : undefined,
    ]

    const rows = await this.db
      .select({
        id: communities.id,
        name: communities.name,
        description: communities.description,
        avatar_url: communities.avatarUrl,
        category: communities.category,
        join_type: communities.joinType,
        member_count: communities.memberCount,
        is_active: communities.isActive,
        user_role: communityMembers.role,
        user_status: communityMembers.status,
      })
      .from(communities)
      .leftJoin(
        communityMembers,
        and(
          eq(communityMembers.communityId, communities.id),
          sql`${communityMembers.userId} = ${uid}::uuid`,
        ),
      )
      .where(and(...where))

    return rows as CommunityFeedRow[]
  }

  /**
   * Create a community + auto-join the owner, ATOMICALLY (the RN did a non-atomic
   * insert-then-manual-rollback). university_domain + owner_id are server-set (anti-K-1).
   *
   * member_count is deliberately NOT set: sync_community_member_count is a DELTA trigger
   * (+1 on an active member insert), so the owner insert takes it 0 → 1. The RN set
   * member_count:1 AND inserted the owner, double-counting to 2 — this fixes that.
   */
  async create(input: CreateCommunityBody, user: AuthPrincipal): Promise<CreateCommunityResult> {
    const domain = this.scope.domain()
    const uid = user.userId

    return this.db.transaction(async (tx) => {
      const inserted = await tx
        .insert(communities)
        .values({
          ownerId: uid,
          universityDomain: domain,
          name: input.name,
          description: input.description,
          category: input.category,
          joinType: input.joinType,
          avatarUrl: input.avatarUrl,
        })
        .returning({ id: communities.id })
      const id = inserted[0]?.id
      if (!id) throw new AppError('INTERNAL', 'Topluluk oluşturulamadı.')

      await tx
        .insert(communityMembers)
        .values({ communityId: id, userId: uid, role: 'owner', status: 'active' })
      return { id }
    })
  }

  /** One community + the caller's membership (detail = single feed row). 404 if cross-uni. */
  async detail(communityId: string, user: AuthPrincipal): Promise<CommunityFeedRow> {
    const uid = user.userId
    const [row] = await this.db
      .select({
        id: communities.id,
        name: communities.name,
        description: communities.description,
        avatar_url: communities.avatarUrl,
        category: communities.category,
        join_type: communities.joinType,
        member_count: communities.memberCount,
        is_active: communities.isActive,
        user_role: communityMembers.role,
        user_status: communityMembers.status,
      })
      .from(communities)
      .leftJoin(
        communityMembers,
        and(
          eq(communityMembers.communityId, communities.id),
          sql`${communityMembers.userId} = ${uid}::uuid`,
        ),
      )
      .where(
        and(
          this.scope.scopeFilter(communities.universityDomain),
          sql`${communities.id} = ${communityId}::uuid`,
        ),
      )
      .limit(1)
    if (!row) throw new AppError('NOT_FOUND', 'Topluluk bulunamadı.')
    return row as CommunityFeedRow
  }

  /** Join a community (open → active, else pending). Already a member → 409. */
  async join(communityId: string, user: AuthPrincipal): Promise<JoinCommunityResult> {
    const [c] = await this.db
      .select({ joinType: communities.joinType })
      .from(communities)
      .where(
        and(
          this.scope.scopeFilter(communities.universityDomain),
          sql`${communities.id} = ${communityId}::uuid`,
        ),
      )
      .limit(1)
    if (!c) throw new AppError('NOT_FOUND', 'Topluluk bulunamadı.')

    const status = c.joinType === 'open' ? 'active' : 'pending'
    try {
      await this.db
        .insert(communityMembers)
        .values({ communityId, userId: user.userId, role: 'member', status })
    } catch (err) {
      if (uniqueViolation(err)) throw new AppError('CONFLICT', 'Bu topluluğa zaten katıldın.')
      throw err
    }
    return { status: status as 'active' | 'pending' }
  }

  /** Leave a community (idempotent). The owner cannot leave. */
  async leave(communityId: string, user: AuthPrincipal): Promise<void> {
    const m = await this.membership(communityId, user.userId)
    if (!m) return
    if (m.role === 'owner') throw new AppError('FORBIDDEN', 'Kurucu topluluktan ayrılamaz.')
    await this.db
      .delete(communityMembers)
      .where(
        and(
          sql`${communityMembers.communityId} = ${communityId}::uuid`,
          sql`${communityMembers.userId} = ${user.userId}::uuid`,
        ),
      )
  }

  // ── Posts ──────────────────────────────────────────────────────────────────

  async posts(communityId: string, user: AuthPrincipal): Promise<CommunityPostRow[]> {
    await this.requireActiveMember(communityId, user.userId)
    const uid = user.userId
    const rows = await this.db
      .select({
        id: communityPosts.id,
        community_id: communityPosts.communityId,
        author_id: communityPosts.authorId,
        body: communityPosts.body,
        image_url: communityPosts.imageUrl,
        is_pinned: communityPosts.isPinned,
        created_at: communityPosts.createdAt,
        author_name: this.authorNameSql(communityPosts.authorId, uid),
      })
      .from(communityPosts)
      .leftJoin(profiles, eq(profiles.id, communityPosts.authorId))
      .leftJoin(userSettings, eq(userSettings.userId, communityPosts.authorId))
      .where(sql`${communityPosts.communityId} = ${communityId}::uuid`)
      .orderBy(desc(communityPosts.isPinned), desc(communityPosts.createdAt))
    return rows as CommunityPostRow[]
  }

  async createPost(
    communityId: string,
    body: CreateCommunityPostBody,
    user: AuthPrincipal,
  ): Promise<CommunityPostRow> {
    await this.requireActiveMember(communityId, user.userId)
    const [ins] = await this.db
      .insert(communityPosts)
      .values({ communityId, authorId: user.userId, body: body.body, imageUrl: body.image_url })
      .returning({
        id: communityPosts.id,
        is_pinned: communityPosts.isPinned,
        created_at: communityPosts.createdAt,
      })
    if (!ins) throw new AppError('INTERNAL', 'Duyuru oluşturulamadı.')
    const [author] = await this.db
      .select({ full_name: profiles.fullName, username: profiles.username })
      .from(profiles)
      .where(eq(profiles.id, user.userId))
      .limit(1)
    return {
      id: ins.id,
      community_id: communityId,
      author_id: user.userId,
      body: body.body,
      image_url: body.image_url,
      is_pinned: ins.is_pinned,
      created_at: ins.created_at as string,
      author_name: author?.full_name ?? author?.username ?? null,
    }
  }

  async deletePost(communityId: string, postId: string, user: AuthPrincipal): Promise<void> {
    const [p] = await this.db
      .select({ authorId: communityPosts.authorId })
      .from(communityPosts)
      .innerJoin(communities, eq(communities.id, communityPosts.communityId))
      .where(
        and(
          this.scope.scopeFilter(communities.universityDomain),
          sql`${communityPosts.id} = ${postId}::uuid`,
          sql`${communityPosts.communityId} = ${communityId}::uuid`,
        ),
      )
      .limit(1)
    if (!p) throw new AppError('NOT_FOUND', 'Duyuru bulunamadı.')
    if (p.authorId !== user.userId && !(await this.isStaff(communityId, user.userId))) {
      throw new AppError('FORBIDDEN', 'Bu duyuruyu silme yetkin yok.')
    }
    await this.db
      .delete(communityPosts)
      .where(sql`${communityPosts.id} = ${postId}::uuid`)
  }

  // ── Events ─────────────────────────────────────────────────────────────────

  async events(communityId: string, user: AuthPrincipal): Promise<CommunityEventRow[]> {
    await this.requireActiveMember(communityId, user.userId)
    const rows = await this.db
      .select({
        id: communityEvents.id,
        community_id: communityEvents.communityId,
        author_id: communityEvents.authorId,
        title: communityEvents.title,
        description: communityEvents.description,
        location: communityEvents.location,
        starts_at: communityEvents.startsAt,
        ends_at: communityEvents.endsAt,
        created_at: communityEvents.createdAt,
      })
      .from(communityEvents)
      .where(sql`${communityEvents.communityId} = ${communityId}::uuid`)
      .orderBy(asc(communityEvents.startsAt))
    return rows as CommunityEventRow[]
  }

  async createEvent(
    communityId: string,
    body: CreateCommunityEventBody,
    user: AuthPrincipal,
  ): Promise<CommunityEventRow> {
    await this.requireActiveMember(communityId, user.userId)
    const [ins] = await this.db
      .insert(communityEvents)
      .values({
        communityId,
        authorId: user.userId,
        title: body.title,
        description: body.description,
        location: body.location,
        startsAt: body.starts_at,
        endsAt: body.ends_at,
      })
      .returning({ id: communityEvents.id, created_at: communityEvents.createdAt })
    if (!ins) throw new AppError('INTERNAL', 'Etkinlik oluşturulamadı.')
    return {
      id: ins.id,
      community_id: communityId,
      author_id: user.userId,
      title: body.title,
      description: body.description,
      location: body.location,
      starts_at: body.starts_at,
      ends_at: body.ends_at,
      created_at: ins.created_at as string,
    }
  }

  async deleteEvent(communityId: string, eventId: string, user: AuthPrincipal): Promise<void> {
    const [e] = await this.db
      .select({ authorId: communityEvents.authorId })
      .from(communityEvents)
      .innerJoin(communities, eq(communities.id, communityEvents.communityId))
      .where(
        and(
          this.scope.scopeFilter(communities.universityDomain),
          sql`${communityEvents.id} = ${eventId}::uuid`,
          sql`${communityEvents.communityId} = ${communityId}::uuid`,
        ),
      )
      .limit(1)
    if (!e) throw new AppError('NOT_FOUND', 'Etkinlik bulunamadı.')
    if (e.authorId !== user.userId && !(await this.isStaff(communityId, user.userId))) {
      throw new AppError('FORBIDDEN', 'Bu etkinliği silme yetkin yok.')
    }
    await this.db
      .delete(communityEvents)
      .where(sql`${communityEvents.id} = ${eventId}::uuid`)
  }

  // ── Members ─────────────────────────────────────────────────────────────────

  async members(communityId: string, user: AuthPrincipal): Promise<CommunityMemberRow[]> {
    await this.requireStaff(communityId, user.userId)
    const rows = await this.db
      .select({
        id: communityMembers.id,
        community_id: communityMembers.communityId,
        user_id: communityMembers.userId,
        role: communityMembers.role,
        status: communityMembers.status,
        created_at: communityMembers.createdAt,
        full_name: profiles.fullName,
        username: profiles.username,
        avatar_url: profiles.avatarUrl,
        is_online: sql<boolean | null>`null`,
        last_seen_at: sql<string | null>`null`,
      })
      .from(communityMembers)
      .leftJoin(profiles, eq(profiles.id, communityMembers.userId))
      .where(sql`${communityMembers.communityId} = ${communityId}::uuid`)
    return rows as CommunityMemberRow[]
  }

  /** Approve a pending join (staff) or promote/demote (owner only). */
  async memberAction(
    communityId: string,
    memberId: string,
    body: MemberActionBody,
    user: AuthPrincipal,
  ): Promise<void> {
    const me = await this.requireStaff(communityId, user.userId)
    const [m] = await this.db
      .select({ role: communityMembers.role })
      .from(communityMembers)
      .where(
        and(
          sql`${communityMembers.id} = ${memberId}::uuid`,
          sql`${communityMembers.communityId} = ${communityId}::uuid`,
        ),
      )
      .limit(1)
    if (!m) throw new AppError('NOT_FOUND', 'Üye bulunamadı.')
    if (m.role === 'owner') throw new AppError('FORBIDDEN', 'Kurucu değiştirilemez.')

    if (body.action === 'approve') {
      await this.db
        .update(communityMembers)
        .set({ status: 'active' })
        .where(sql`${communityMembers.id} = ${memberId}::uuid`)
      return
    }
    // promote / demote — owner only
    if (me.role !== 'owner') throw new AppError('FORBIDDEN', 'Rol değişikliği yalnızca kurucuya açık.')
    await this.db
      .update(communityMembers)
      .set({ role: body.action === 'promote' ? 'admin' : 'member' })
      .where(sql`${communityMembers.id} = ${memberId}::uuid`)
  }

  /** Remove a member / reject a pending join (staff). The owner cannot be removed. */
  async removeMember(communityId: string, memberId: string, user: AuthPrincipal): Promise<void> {
    await this.requireStaff(communityId, user.userId)
    const [m] = await this.db
      .select({ role: communityMembers.role })
      .from(communityMembers)
      .where(
        and(
          sql`${communityMembers.id} = ${memberId}::uuid`,
          sql`${communityMembers.communityId} = ${communityId}::uuid`,
        ),
      )
      .limit(1)
    if (!m) throw new AppError('NOT_FOUND', 'Üye bulunamadı.')
    if (m.role === 'owner') throw new AppError('FORBIDDEN', 'Kurucu çıkarılamaz.')
    await this.db
      .delete(communityMembers)
      .where(sql`${communityMembers.id} = ${memberId}::uuid`)
  }

  // ── Authorization helpers (RLS replacement) ──────────────────────────────────

  /** Author-visibility CASE shared by post listings (accountable, respects visibility). */
  private authorNameSql(authorIdCol: typeof communityPosts.authorId, uid: string) {
    return sql<string>`case
      when ${authorIdCol} = ${uid}::uuid then coalesce(${profiles.fullName}, ${profiles.username}, 'Öğrenci')
      when coalesce(${userSettings.profileVisibilityEnabled}, true) then coalesce(${profiles.fullName}, ${profiles.username}, 'Öğrenci')
      else 'Anonim Öğrenci'
    end`
  }

  /** The caller's membership, fail-closed if the community is out of the caller's university. */
  private async membership(communityId: string, uid: string): Promise<Membership | null> {
    const [c] = await this.db
      .select({ id: communities.id })
      .from(communities)
      .where(
        and(
          this.scope.scopeFilter(communities.universityDomain),
          sql`${communities.id} = ${communityId}::uuid`,
        ),
      )
      .limit(1)
    if (!c) throw new AppError('NOT_FOUND', 'Topluluk bulunamadı.')

    const [m] = await this.db
      .select({ role: communityMembers.role, status: communityMembers.status })
      .from(communityMembers)
      .where(
        and(
          sql`${communityMembers.communityId} = ${communityId}::uuid`,
          sql`${communityMembers.userId} = ${uid}::uuid`,
        ),
      )
      .limit(1)
    return m ?? null
  }

  private async requireActiveMember(communityId: string, uid: string): Promise<Membership> {
    const m = await this.membership(communityId, uid)
    if (!m || m.status !== 'active') {
      throw new AppError('FORBIDDEN', 'Bu işlem için topluluğa aktif üye olmalısın.')
    }
    return m
  }

  private async requireStaff(communityId: string, uid: string): Promise<Membership> {
    const m = await this.requireActiveMember(communityId, uid)
    if (m.role !== 'owner' && m.role !== 'admin') {
      throw new AppError('FORBIDDEN', 'Bu işlem için yöneticilik yetkisi gerekir.')
    }
    return m
  }

  private async isStaff(communityId: string, uid: string): Promise<boolean> {
    const m = await this.membership(communityId, uid)
    return !!m && m.status === 'active' && (m.role === 'owner' || m.role === 'admin')
  }
}

/** True if the error is a Postgres unique-violation (drizzle wraps it on `.cause`). */
function uniqueViolation(err: unknown): boolean {
  const code =
    (err as { cause?: { code?: string } })?.cause?.code ?? (err as { code?: string })?.code
  return code === '23505'
}
