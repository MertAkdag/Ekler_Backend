import { Controller, Get, Inject } from '@nestjs/common'
import { sql } from 'drizzle-orm'
import { Public } from '../../core/auth/public.decorator'
import { DRIZZLE, type Db } from '../../db/drizzle.module'

@Controller('health')
export class HealthController {
  constructor(@Inject(DRIZZLE) private readonly db: Db) {}

  /** Liveness — no auth, no DB. */
  @Public()
  @Get()
  live(): { status: 'ok'; ts: string } {
    return { status: 'ok', ts: new Date().toISOString() }
  }

  /** Readiness — verifies the DB connection. */
  @Public()
  @Get('db')
  async ready(): Promise<{ status: 'ok' | 'degraded'; db: boolean }> {
    try {
      await this.db.execute(sql`select 1`)
      return { status: 'ok', db: true }
    } catch {
      return { status: 'degraded', db: false }
    }
  }
}
