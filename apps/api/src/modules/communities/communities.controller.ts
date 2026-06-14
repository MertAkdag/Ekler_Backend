import { Body, Controller, Delete, Get, HttpCode, Param, Patch, Post, Query } from '@nestjs/common'
import type {
  CommunityEventRow,
  CommunityFeedRow,
  CommunityMemberRow,
  CommunityPostRow,
  CreateCommunityResult,
  JoinCommunityResult,
} from '@ekler/contracts'
import { CurrentUser } from '../../core/auth/public.decorator'
import type { AuthPrincipal } from '../../core/cls/cls-store'
import { RateLimit } from '../../core/throttler/rate-limits'
import { CommunitiesService } from './communities.service'
import {
  CommunityFeedQueryDto,
  CreateCommunityBodyDto,
  CreateCommunityEventBodyDto,
  CreateCommunityPostBodyDto,
  MemberActionBodyDto,
} from './communities.dto'

@Controller('communities')
export class CommunitiesController {
  constructor(private readonly communities: CommunitiesService) {}

  // ── Static routes first (must precede `:id`) ───────────────────────────────

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

  // ── Detail ──────────────────────────────────────────────────────────────────

  @Get(':id')
  detail(@CurrentUser() user: AuthPrincipal, @Param('id') id: string): Promise<CommunityFeedRow> {
    return this.communities.detail(id, user)
  }

  // ── Membership ────────────────────────────────────────────────────────────

  /** Join a community (open → active, else pending). */
  @Post(':id/members')
  join(@CurrentUser() user: AuthPrincipal, @Param('id') id: string): Promise<JoinCommunityResult> {
    return this.communities.join(id, user)
  }

  /** Leave a community (self; owner cannot leave). */
  @Delete(':id/members')
  @HttpCode(204)
  leave(@CurrentUser() user: AuthPrincipal, @Param('id') id: string): Promise<void> {
    return this.communities.leave(id, user)
  }

  /** Member list — staff only (with profiles). */
  @Get(':id/members')
  members(
    @CurrentUser() user: AuthPrincipal,
    @Param('id') id: string,
  ): Promise<CommunityMemberRow[]> {
    return this.communities.members(id, user)
  }

  /** Approve a pending join (staff) / promote / demote (owner). */
  @Patch(':id/members/:memberId')
  @HttpCode(204)
  memberAction(
    @CurrentUser() user: AuthPrincipal,
    @Param('id') id: string,
    @Param('memberId') memberId: string,
    @Body() body: MemberActionBodyDto,
  ): Promise<void> {
    return this.communities.memberAction(id, memberId, body, user)
  }

  /** Remove a member / reject a pending join (staff). */
  @Delete(':id/members/:memberId')
  @HttpCode(204)
  removeMember(
    @CurrentUser() user: AuthPrincipal,
    @Param('id') id: string,
    @Param('memberId') memberId: string,
  ): Promise<void> {
    return this.communities.removeMember(id, memberId, user)
  }

  // ── Posts ────────────────────────────────────────────────────────────────

  @Get(':id/posts')
  posts(@CurrentUser() user: AuthPrincipal, @Param('id') id: string): Promise<CommunityPostRow[]> {
    return this.communities.posts(id, user)
  }

  @Post(':id/posts')
  @RateLimit('comment')
  createPost(
    @CurrentUser() user: AuthPrincipal,
    @Param('id') id: string,
    @Body() body: CreateCommunityPostBodyDto,
  ): Promise<CommunityPostRow> {
    return this.communities.createPost(id, body, user)
  }

  @Delete(':id/posts/:postId')
  @HttpCode(204)
  deletePost(
    @CurrentUser() user: AuthPrincipal,
    @Param('id') id: string,
    @Param('postId') postId: string,
  ): Promise<void> {
    return this.communities.deletePost(id, postId, user)
  }

  // ── Events ───────────────────────────────────────────────────────────────

  @Get(':id/events')
  events(
    @CurrentUser() user: AuthPrincipal,
    @Param('id') id: string,
  ): Promise<CommunityEventRow[]> {
    return this.communities.events(id, user)
  }

  @Post(':id/events')
  @RateLimit('comment')
  createEvent(
    @CurrentUser() user: AuthPrincipal,
    @Param('id') id: string,
    @Body() body: CreateCommunityEventBodyDto,
  ): Promise<CommunityEventRow> {
    return this.communities.createEvent(id, body, user)
  }

  @Delete(':id/events/:eventId')
  @HttpCode(204)
  deleteEvent(
    @CurrentUser() user: AuthPrincipal,
    @Param('id') id: string,
    @Param('eventId') eventId: string,
  ): Promise<void> {
    return this.communities.deleteEvent(id, eventId, user)
  }
}
