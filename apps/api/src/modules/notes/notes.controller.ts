import { Body, Controller, Delete, Get, HttpCode, Param, Post, Query } from '@nestjs/common'
import type {
  CreateNoteResult,
  ListEnvelope,
  NoteCommentRow,
  NoteFeedRow,
} from '@ekler/contracts'
import { CurrentUser } from '../../core/auth/public.decorator'
import type { AuthPrincipal } from '../../core/cls/cls-store'
import { RateLimit } from '../../core/throttler/rate-limits'
import { NotesService } from './notes.service'
import {
  CreateNoteBodyDto,
  CreateNoteCommentBodyDto,
  NoteCommentsQueryDto,
  NoteFeedQueryDto,
  NoteVoteBodyDto,
} from './notes.dto'

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

  /** Create a note record (file uploaded to storage first; this carries its key). */
  @Post()
  @RateLimit('note')
  create(
    @CurrentUser() user: AuthPrincipal,
    @Body() body: CreateNoteBodyDto,
  ): Promise<CreateNoteResult> {
    return this.notes.create(body, user)
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

  /** Atomic +1 download counter. */
  @Post(':id/download')
  @HttpCode(204)
  download(@CurrentUser() user: AuthPrincipal, @Param('id') noteId: string): Promise<void> {
    return this.notes.download(noteId, user)
  }

  /** Comment list for a note — keyset ASC, scoped via the parent note. */
  @Get(':id/comments')
  comments(
    @CurrentUser() user: AuthPrincipal,
    @Param('id') noteId: string,
    @Query() q: NoteCommentsQueryDto,
  ): Promise<ListEnvelope<NoteCommentRow>> {
    return this.notes.comments(noteId, q, user)
  }

  /** Add a comment to a note (accountable). */
  @Post(':id/comments')
  @RateLimit('comment')
  createComment(
    @CurrentUser() user: AuthPrincipal,
    @Param('id') noteId: string,
    @Body() body: CreateNoteCommentBodyDto,
  ): Promise<NoteCommentRow> {
    return this.notes.createComment(noteId, body, user)
  }

  /** Delete a note — author or admin only (+ best-effort file cleanup). */
  @Delete(':id')
  @HttpCode(204)
  remove(@CurrentUser() user: AuthPrincipal, @Param('id') noteId: string): Promise<void> {
    return this.notes.remove(noteId, user)
  }
}
