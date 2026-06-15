import { Inject, Injectable } from '@nestjs/common'
import { sql } from 'drizzle-orm'
import type { TelemetryEventBody } from '@ekler/contracts'
import { DRIZZLE, type Db } from '../../db/drizzle.module'
import type { AuthPrincipal } from '../../core/cls/cls-store'

/**
 * Client telemetry ingest — replaces the RN trackedFetch that POSTed to the legacy REST API.
 * Inserts into the partitioned parent `app_telemetry_events` (routes to the right
 * partition by created_at). Best-effort: a failed insert must never surface to the UX,
 * so the controller swallows errors.
 */
@Injectable()
export class TelemetryService {
  constructor(@Inject(DRIZZLE) private readonly db: Db) {}

  async log(body: TelemetryEventBody, user: AuthPrincipal): Promise<void> {
    await this.db.execute(sql`
      insert into public.app_telemetry_events
        (user_id, event_type, platform, app_version, route, endpoint, status_code, response_ms, error_code, metadata)
      values (
        ${user.userId}::uuid, ${body.event_type}, ${body.platform}, ${body.app_version},
        ${body.route}, ${body.endpoint}, ${body.status_code}, ${body.response_ms},
        ${body.error_code}, ${JSON.stringify(body.metadata ?? {})}::jsonb
      )`)
  }
}
