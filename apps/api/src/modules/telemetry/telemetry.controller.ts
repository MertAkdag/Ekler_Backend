import { Body, Controller, HttpCode, Post } from '@nestjs/common'
import { CurrentUser } from '../../core/auth/public.decorator'
import type { AuthPrincipal } from '../../core/cls/cls-store'
import { TelemetryService } from './telemetry.service'
import { TelemetryEventBodyDto } from './telemetry.dto'

@Controller('telemetry')
export class TelemetryController {
  constructor(private readonly telemetry: TelemetryService) {}

  /** Ingest one client telemetry event (best-effort; user_id from the principal). */
  @Post('events')
  @HttpCode(204)
  async events(
    @CurrentUser() user: AuthPrincipal,
    @Body() body: TelemetryEventBodyDto,
  ): Promise<void> {
    try {
      await this.telemetry.log(body, user)
    } catch {
      // telemetry is best-effort — never fail the request
    }
  }
}
