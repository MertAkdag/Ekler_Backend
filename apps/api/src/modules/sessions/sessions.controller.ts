import { Body, Controller, Get, HttpCode, Param, Post, Query } from '@nestjs/common'
import type { CreateSessionResult, SessionFeedRow } from '@ekler/contracts'
import { CurrentUser } from '../../core/auth/public.decorator'
import type { AuthPrincipal } from '../../core/cls/cls-store'
import { RateLimit } from '../../core/throttler/rate-limits'
import { SessionsService } from './sessions.service'
import { CreateSessionBodyDto, SessionFeedQueryDto } from './sessions.dto'

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

  /** Create a session + auto-join the creator (atomic). */
  @Post()
  create(
    @CurrentUser() user: AuthPrincipal,
    @Body() body: CreateSessionBodyDto,
  ): Promise<CreateSessionResult> {
    return this.sessions.create(body, user)
  }

  /** Join a session. */
  @Post(':id/join')
  @RateLimit('sessionJoin')
  @HttpCode(204)
  join(@CurrentUser() user: AuthPrincipal, @Param('id') id: string): Promise<void> {
    return this.sessions.join(id, user)
  }

  /** Leave a session (idempotent). */
  @Post(':id/leave')
  @HttpCode(204)
  leave(@CurrentUser() user: AuthPrincipal, @Param('id') id: string): Promise<void> {
    return this.sessions.leave(id, user)
  }

  /** End a session — creator only. */
  @Post(':id/end')
  @HttpCode(204)
  end(@CurrentUser() user: AuthPrincipal, @Param('id') id: string): Promise<void> {
    return this.sessions.end(id, user)
  }
}
