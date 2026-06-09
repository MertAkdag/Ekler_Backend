import { Controller, Get, Query } from '@nestjs/common'
import type { EventFeedRow } from '@ekler/contracts'
import { CurrentUser } from '../../core/auth/public.decorator'
import type { AuthPrincipal } from '../../core/cls/cls-store'
import { EventsService } from './events.service'
import { EventFeedQueryDto } from './events.dto'

@Controller('events')
export class EventsController {
  constructor(private readonly events: EventsService) {}

  /** Authenticated city-events feed — scoped to the caller's city (resolved from domain). */
  @Get('feed')
  feed(
    @CurrentUser() user: AuthPrincipal,
    @Query() q: EventFeedQueryDto,
  ): Promise<EventFeedRow[]> {
    return this.events.feed(q, user)
  }
}
