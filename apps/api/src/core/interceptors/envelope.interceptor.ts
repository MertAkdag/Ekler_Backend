import { CallHandler, ExecutionContext, Injectable, NestInterceptor } from '@nestjs/common'
import { Observable } from 'rxjs'
import { map } from 'rxjs/operators'

/**
 * Wraps every successful response in the `{ data }` envelope.
 * - A handler returning `{ data, meta }` (a list page) is passed through untouched.
 * - Anything else is wrapped as `{ data: <value> }`.
 * - `undefined`/`null` (e.g. 204) is left alone.
 */
@Injectable()
export class EnvelopeInterceptor implements NestInterceptor {
  intercept(_ctx: ExecutionContext, next: CallHandler): Observable<unknown> {
    return next.handle().pipe(
      map((value) => {
        if (value === undefined || value === null) return value
        if (typeof value === 'object' && value !== null && 'data' in value) {
          return value // already enveloped (list page or explicit envelope)
        }
        return { data: value }
      }),
    )
  }
}
