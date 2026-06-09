import { Body, Controller, Get, Post, Query } from '@nestjs/common'
import type { CommunityFeedRow, CreateCommunityResult } from '@ekler/contracts'
import { CurrentUser } from '../../core/auth/public.decorator'
import type { AuthPrincipal } from '../../core/cls/cls-store'
import { CommunitiesService } from './communities.service'
import { CommunityFeedQueryDto, CreateCommunityBodyDto } from './communities.dto'

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

  /** Create a community + auto-join the owner (atomic). */
  @Post()
  create(
    @CurrentUser() user: AuthPrincipal,
    @Body() body: CreateCommunityBodyDto,
  ): Promise<CreateCommunityResult> {
    return this.communities.create(body, user)
  }
}
