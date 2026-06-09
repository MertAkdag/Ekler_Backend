import { Controller, Get, Query } from '@nestjs/common'
import type { SessionFeedRow } from '@ekler/contracts'
import { CurrentUser } from '../../core/auth/public.decorator'
import type { AuthPrincipal } from '../../core/cls/cls-store'
import { SessionsService } from './sessions.service'
import { SessionFeedQueryDto } from './sessions.dto'

@Controller('sessions')
export class SessionsController {
  constructor(private readonly sessions: SessionsService) {}

  /** Authenticated study-sessions feed — scoped to the caller's university_domain. */
  @Get('feed')
  feed(
    @CurrentUser() user: AuthPrincipal,
    @Query() q: SessionFeedQueryDto,
  ): Promise<SessionFeedRow[]> {
    return this.sessions.feed(q, user)
  }
}
