import { Controller, Get, Query } from '@nestjs/common'
import type { CommunityFeedRow } from '@ekler/contracts'
import { CurrentUser } from '../../core/auth/public.decorator'
import type { AuthPrincipal } from '../../core/cls/cls-store'
import { CommunitiesService } from './communities.service'
import { CommunityFeedQueryDto } from './communities.dto'

@Controller('communities')
export class CommunitiesController {
  constructor(private readonly communities: CommunitiesService) {}

  /** Authenticated communities feed — scoped to the caller's university_domain (anti-K-1). */
  @Get('feed')
  feed(
    @CurrentUser() user: AuthPrincipal,
    @Query() q: CommunityFeedQueryDto,
  ): Promise<CommunityFeedRow[]> {
    return this.communities.feed(q, user)
  }
}
