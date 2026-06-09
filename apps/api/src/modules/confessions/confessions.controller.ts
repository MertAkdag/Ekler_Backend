import { Body, Controller, Get, Post, Query } from '@nestjs/common'
import type {
  ConfessionFeedRow,
  CreateConfessionResult,
  ListEnvelope,
} from '@ekler/contracts'
import { CurrentUser } from '../../core/auth/public.decorator'
import type { AuthPrincipal } from '../../core/cls/cls-store'
import { ConfessionsService } from './confessions.service'
import { ConfessionFeedQueryDto, CreateConfessionBodyDto } from './confessions.dto'

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
  create(
    @CurrentUser() user: AuthPrincipal,
    @Body() body: CreateConfessionBodyDto,
  ): Promise<CreateConfessionResult> {
    return this.confessions.create(body, user)
  }
}
