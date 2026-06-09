import { Controller, Get, Query } from '@nestjs/common'
import type { NoteFeedRow } from '@ekler/contracts'
import { CurrentUser } from '../../core/auth/public.decorator'
import type { AuthPrincipal } from '../../core/cls/cls-store'
import { NotesService } from './notes.service'
import { NoteFeedQueryDto } from './notes.dto'

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
}
