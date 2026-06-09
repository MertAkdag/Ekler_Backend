import { Body, Controller, Get, Param, Post, Query } from '@nestjs/common'
import type {
  ConfessionCommentRow,
  ConfessionFeedRow,
  CreateCommentResult,
  CreateConfessionResult,
  ListEnvelope,
} from '@ekler/contracts'
import { CurrentUser } from '../../core/auth/public.decorator'
import type { AuthPrincipal } from '../../core/cls/cls-store'
import { RateLimit } from '../../core/throttler/rate-limits'
import { ConfessionsService } from './confessions.service'
import {
  ConfessionCommentsQueryDto,
  ConfessionFeedQueryDto,
  CreateCommentBodyDto,
  CreateConfessionBodyDto,
} from './confessions.dto'

@Controller('confessions')
export class ConfessionsController {
  constructor(private readonly confessions: ConfessionsService) {}

  /** Authenticated read feed — scoped to the caller's university_domain (anti-K-1). */
  @Get('feed')
  feed(
    @CurrentUser() user: AuthPrincipal,
    @Query() q: ConfessionFeedQueryDto,
  ): Promise<ListEnvelope<ConfessionFeedRow>> {
    return this.confessions.feed(q, user)
  }

  /** Create a confession — moderation runs server-side (create_confession_v2). */
  @Post()
  @RateLimit('confession')
  create(
    @CurrentUser() user: AuthPrincipal,
    @Body() body: CreateConfessionBodyDto,
  ): Promise<CreateConfessionResult> {
    return this.confessions.create(body, user)
  }

  /** Comment list for a confession — keyset ASC, scoped via the parent confession. */
  @Get(':id/comments')
  comments(
    @CurrentUser() user: AuthPrincipal,
    @Param('id') confessionId: string,
    @Query() q: ConfessionCommentsQueryDto,
  ): Promise<ListEnvelope<ConfessionCommentRow>> {
    return this.confessions.comments(confessionId, q, user)
  }

  /** Create a comment — moderation runs server-side (create_confession_comment_v2). */
  @Post(':id/comments')
  @RateLimit('comment')
  createComment(
    @CurrentUser() user: AuthPrincipal,
    @Param('id') confessionId: string,
    @Body() body: CreateCommentBodyDto,
  ): Promise<CreateCommentResult> {
    return this.confessions.createComment(confessionId, body, user)
  }
}
