import { Inject, Injectable } from '@nestjs/common'
import { and, eq, sql } from 'drizzle-orm'
import type { CommunityFeedQuery, CommunityFeedRow } from '@ekler/contracts'
import { DRIZZLE, type Db } from '../../db/drizzle.module'
import { ScopedRepository } from '../../db/scoped/scoped-repository'
import { communities, communityMembers } from '../../db/schema'
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
}
