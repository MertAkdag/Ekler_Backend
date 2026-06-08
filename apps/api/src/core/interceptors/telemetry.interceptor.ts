import { CallHandler, ExecutionContext, Injectable, Logger, NestInterceptor } from '@nestjs/common'
import { ClsService } from 'nestjs-cls'
import { Observable } from 'rxjs'
import { tap } from 'rxjs/operators'
import type { AppClsStore } from '../cls/cls-store'

/**
 * Structured per-request telemetry. For now logs method/route/status/duration;
 * Phase 5 also persists to `app_telemetry_events` (replacing the RN
 * `trackedFetch` wrapper). Never throws — telemetry must not break the request.
 */
@Injectable()
export class TelemetryInterceptor implements NestInterceptor {
  private readonly logger = new Logger('http')

  constructor(private readonly cls: ClsService<AppClsStore>) {}

  intercept(ctx: ExecutionContext, next: CallHandler): Observable<unknown> {
    const startedAt = Date.now()
    const req = ctx.switchToHttp().getRequest()
    const method = req?.method
    const route = req?.routeOptions?.url ?? req?.url

    const finalize = (outcome: 'ok' | 'error') => {
      const ms = Date.now() - startedAt
      this.logger.log(
        JSON.stringify({
          requestId: this.cls.get('requestId'),
          userId: this.cls.get('principal')?.userId ?? null,
          method,
          route,
          outcome,
          ms,
        }),
      )
    }

    return next.handle().pipe(
      tap({
        next: () => finalize('ok'),
        error: () => finalize('error'),
      }),
    )
  }
}
