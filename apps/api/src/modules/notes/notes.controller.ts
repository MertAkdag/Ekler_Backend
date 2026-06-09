import { Body, Controller, Get, HttpCode, Param, Post, Query } from '@nestjs/common'
import type { NoteFeedRow } from '@ekler/contracts'
import { CurrentUser } from '../../core/auth/public.decorator'
import type { AuthPrincipal } from '../../core/cls/cls-store'
import { RateLimit } from '../../core/throttler/rate-limits'
import { NotesService } from './notes.service'
import { NoteFeedQueryDto, NoteVoteBodyDto } from './notes.dto'

@Controller('notes')
export class NotesController {
  constructor(private readonly notes: NotesService) {}

  /** Authenticated notes feed — scoped to the caller's university_domain (anti-K-1). */
  @Get('feed')
  feed(
    @CurrentUser() user: AuthPrincipal,
    @Query() q: NoteFeedQueryDto,
  ): Promise<NoteFeedRow[]> {
    return this.notes.feed(q, user)
  }

  /** Vote on a note (up/down/null=remove). vote_score is recomputed by a DB trigger. */
  @Post(':id/vote')
  @RateLimit('reaction')
  @HttpCode(204)
  vote(
    @CurrentUser() user: AuthPrincipal,
    @Param('id') noteId: string,
    @Body() body: NoteVoteBodyDto,
  ): Promise<void> {
    return this.notes.vote(noteId, body, user)
  }
}
