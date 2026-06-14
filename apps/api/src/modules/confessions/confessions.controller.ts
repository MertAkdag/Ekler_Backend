import {
  Body,
  Controller,
  Delete,
  Get,
  HttpCode,
  Param,
  Post,
  Query,
} from '@nestjs/common'
import type {
  ConfessionCommentRow,
  ConfessionFeedRow,
  CreateCommentResult,
  CreateConfessionResult,
  ListEnvelope,
  PreviewSubmissionResult,
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
  PreviewSubmissionBodyDto,
} from './confessions.dto'

@Controller('confessions')
export class ConfessionsController {
  constructor(private readonly confessions: ConfessionsService) {}

  // ── Static routes first (must precede the `:id` param routes) ──────────────

  /** Authenticated read feed — scoped to the caller's university_domain (anti-K-1). */
  @Get('feed')
  feed(
    @CurrentUser() user: AuthPrincipal,
    @Query() q: ConfessionFeedQueryDto,
  ): Promise<ListEnvelope<ConfessionFeedRow>> {
    return this.confessions.feed(q, user)
  }

  /** Pre-flight moderation signal (preview_kursu_submission). */
  @Post('preview')
  @RateLimit('comment')
  preview(
    @CurrentUser() user: AuthPrincipal,
    @Body() body: PreviewSubmissionBodyDto,
  ): Promise<PreviewSubmissionResult> {
    return this.confessions.preview(body, user)
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

  // ── Param routes ───────────────────────────────────────────────────────────

  /** Single confession with the viewer's like/bookmark/mine state. */
  @Get(':id')
  detail(
    @CurrentUser() user: AuthPrincipal,
    @Param('id') id: string,
  ): Promise<ConfessionFeedRow> {
    return this.confessions.detail(id, user)
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

  /** Like a confession (idempotent). */
  @Post(':id/likes')
  @RateLimit('reaction')
  @HttpCode(204)
  like(@CurrentUser() user: AuthPrincipal, @Param('id') id: string): Promise<void> {
    return this.confessions.like(id, user)
  }

  /** Remove a like (idempotent). */
  @Delete(':id/likes')
  @HttpCode(204)
  unlike(@CurrentUser() user: AuthPrincipal, @Param('id') id: string): Promise<void> {
    return this.confessions.unlike(id, user)
  }

  /** Bookmark a confession (idempotent). */
  @Post(':id/bookmarks')
  @RateLimit('reaction')
  @HttpCode(204)
  bookmark(@CurrentUser() user: AuthPrincipal, @Param('id') id: string): Promise<void> {
    return this.confessions.bookmark(id, user)
  }

  /** Remove a bookmark (idempotent). */
  @Delete(':id/bookmarks')
  @HttpCode(204)
  unbookmark(@CurrentUser() user: AuthPrincipal, @Param('id') id: string): Promise<void> {
    return this.confessions.unbookmark(id, user)
  }

  /** Delete a confession — author or admin only (+ best-effort image cleanup). */
  @Delete(':id')
  @HttpCode(204)
  remove(@CurrentUser() user: AuthPrincipal, @Param('id') id: string): Promise<void> {
    return this.confessions.remove(id, user)
  }
}
