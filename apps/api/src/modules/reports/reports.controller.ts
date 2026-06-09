import { Body, Controller, HttpCode, Post } from '@nestjs/common'
import { CurrentUser } from '../../core/auth/public.decorator'
import type { AuthPrincipal } from '../../core/cls/cls-store'
import { RateLimit } from '../../core/throttler/rate-limits'
import { ReportsService } from './reports.service'
import { CreateReportBodyDto } from './reports.dto'

@Controller('reports')
export class ReportsController {
  constructor(private readonly reports: ReportsService) {}

  /** Report a confession / comment / note / user (target must be in the caller's university). */
  @Post()
  @RateLimit('report')
  @HttpCode(204)
  create(
    @CurrentUser() user: AuthPrincipal,
    @Body() body: CreateReportBodyDto,
  ): Promise<void> {
    return this.reports.create(body, user)
  }
}
