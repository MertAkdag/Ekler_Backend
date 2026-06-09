import { Inject, Injectable } from '@nestjs/common'
import { and, eq, sql } from 'drizzle-orm'
import type {
  CommunityFeedQuery,
  CommunityFeedRow,
  CreateCommunityBody,
  CreateCommunityResult,
} from '@ekler/contracts'
import { DRIZZLE, type Db } from '../../db/drizzle.module'
import { ScopedRepository } from '../../db/scoped/scoped-repository'
import { communities, communityMembers } from '../../db/schema'
import { AppError } from '../../core/errors/app-error'
import type { AuthPrincipal } from '../../core/cls/cls-store'

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
}
