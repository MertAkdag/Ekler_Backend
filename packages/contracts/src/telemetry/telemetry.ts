import { z } from 'zod'

/**
 * POST /v1/telemetry/events — client telemetry ingest (replaces the RN trackedFetch
 * that POSTed to Supabase REST). user_id is taken from the auth principal server-side.
 */
export const telemetryEventBodySchema = z.object({
  event_type: z.enum(['app_open', 'heartbeat', 'screen_view', 'api_error', 'api_success']),
  route: z.string().max(200).nullable().default(null),
  endpoint: z.string().max(200).nullable().default(null),
  status_code: z.number().int().nullable().default(null),
  response_ms: z.number().int().nullable().default(null),
  error_code: z.string().max(80).nullable().default(null),
  app_version: z.string().max(40).nullable().default(null),
  platform: z.string().max(20).nullable().default(null),
  metadata: z.record(z.string(), z.unknown()).default({}),
})
export type TelemetryEventBody = z.infer<typeof telemetryEventBodySchema>
