import { CallHandler, ExecutionContext, Injectable, NestInterceptor } from '@nestjs/common'
import { Observable } from 'rxjs'
import { map } from 'rxjs/operators'

/**
 * Postgres renders timestamptz as space-separated text ("2026-06-15 10:00:00+00"); drizzle
 * (mode:'string') passes it through raw, but the RN client's Date parser (Hermes) can't
 * parse the space form → Invalid Date → NaN in time/duration math. PostgREST/Supabase
 * always returned ISO-8601, so we normalize timestamp-ish values to ISO here. Guarded by
 * BOTH a `_at` key suffix AND the exact PG-timestamp shape, so user content is never touched
 * (and already-ISO values, which use `T`, don't match → idempotent).
 */
const PG_TIMESTAMP = /^\d{4}-\d{2}-\d{2} \d{2}:\d{2}:\d{2}(\.\d+)?([+-]\d{2}(:?\d{2})?|Z)?$/

function normalizeTimestamps(node: unknown): void {
  if (Array.isArray(node)) {
    for (const item of node) normalizeTimestamps(item)
    return
  }
  if (node && typeof node === 'object') {
    const obj = node as Record<string, unknown>
    for (const key of Object.keys(obj)) {
      const val = obj[key]
      if (typeof val === 'string') {
        if (key.endsWith('_at') && PG_TIMESTAMP.test(val)) {
          const d = new Date(val)
          if (!Number.isNaN(d.getTime())) obj[key] = d.toISOString()
        }
      } else if (val && typeof val === 'object') {
        normalizeTimestamps(val)
      }
    }
  }
}

/**
 * Wraps every successful response in the `{ data }` envelope.
 * - A handler returning `{ data, meta }` (a list page) is passed through untouched.
 * - Anything else is wrapped as `{ data: <value> }`.
 * - `undefined`/`null` (e.g. 204) is left alone.
 * Also normalizes timestamp fields to ISO-8601 (see above).
 */
@Injectable()
export class EnvelopeInterceptor implements NestInterceptor {
  intercept(_ctx: ExecutionContext, next: CallHandler): Observable<unknown> {
    return next.handle().pipe(
      map((value) => {
        if (value === undefined || value === null) return value
        const enveloped =
          typeof value === 'object' && value !== null && 'data' in value
            ? value
            : { data: value }
        normalizeTimestamps(enveloped)
        return enveloped
      }),
    )
  }
}
