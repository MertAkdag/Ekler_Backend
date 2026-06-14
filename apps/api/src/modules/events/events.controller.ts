import { Body, Controller, Get, HttpCode, Post, Query } from '@nestjs/common'
import type { EventFeedRow, EventStorySlotRow, ViewerCity } from '@ekler/contracts'
import { CurrentUser } from '../../core/auth/public.decorator'
import type { AuthPrincipal } from '../../core/cls/cls-store'
import { EventsService } from './events.service'
import { EventFeedQueryDto, LogEventBodyDto } from './events.dto'

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

  /** Active event-story slots for the caller's city. */
  @Get('stories')
  stories(@CurrentUser() user: AuthPrincipal): Promise<EventStorySlotRow[]> {
    return this.events.stories(user)
  }

  /** The caller's resolved city (from university_domain). */
  @Get('city-context')
  cityContext(@CurrentUser() user: AuthPrincipal): Promise<ViewerCity | null> {
    return this.events.cityContext(user)
  }

  /** Campaign analytics log (story impressions / taps / CTA clicks). */
  @Post('logs')
  @HttpCode(204)
  logEvent(@CurrentUser() user: AuthPrincipal, @Body() body: LogEventBodyDto): Promise<void> {
    return this.events.logEvent(body, user)
  }
}
