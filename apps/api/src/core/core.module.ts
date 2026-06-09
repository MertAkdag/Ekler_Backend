import { Global, Module } from '@nestjs/common'
import { APP_FILTER, APP_GUARD, APP_INTERCEPTOR, APP_PIPE } from '@nestjs/core'
import { ClsModule, ClsGuard } from 'nestjs-cls'
import { ThrottlerModule } from '@nestjs/throttler'
import { ENV, loadEnv } from '../config/env'
import { DrizzleModule } from '../db/drizzle.module'
import { ScopedRepository } from '../db/scoped/scoped-repository'
import { AuthGuard } from './auth/auth.guard'
import { BanGuard } from './ban/ban.guard'
import { ClsThrottlerGuard } from './throttler/cls-throttler.guard'
import { RATE_LIMITS } from './throttler/rate-limits'
import { ZodValidationPipe } from './validation/zod-validation.pipe'
import { TelemetryInterceptor } from './interceptors/telemetry.interceptor'
import { EnvelopeInterceptor } from './interceptors/envelope.interceptor'
import { AllExceptionFilter } from './filters/all-exception.filter'

/**
 * The cross-cutting backbone. Global guard order is LOAD-BEARING and is enforced
 * by the order of the APP_GUARD providers below:
 *
 *   1. ClsGuard       — opens the AsyncLocalStorage store, stamps requestId
 *   2. AuthGuard      — verifies JWT, resolves principal (incl. universityDomain) → CLS
 *   3. BanGuard       — blocks banned/restricted users on write routes
 *   4. ClsThrottlerGuard — rate-limits keyed by CLS userId
 *
 * Then: ZodValidationPipe (422), Telemetry + Envelope interceptors, AllExceptionFilter.
 */
@Global()
@Module({
  imports: [
    ClsModule.forRoot({
      global: true,
      // Mounted manually below as the FIRST APP_GUARD so CLS is available to the
      // auth/ban/throttler guards. generateId seeds the requestId.
      guard: {
        mount: false,
        generateId: true,
        setup: (cls) => cls.set('requestId', cls.getId()),
      },
    }),
    // Only the lax `default` limiter (120/60s) applies globally. The strict named
    // limiters (confession 3/60s, etc.) are NOT registered globally — @nestjs/throttler
    // applies EVERY registered throttler to EVERY route, so registering them all here
    // capped the whole API at the strictest (3/60s). They are applied per-route via
    // @Throttle in Phase 3 instead.
    ThrottlerModule.forRoot({ throttlers: [RATE_LIMITS.default] }),
    DrizzleModule,
  ],
  providers: [
    { provide: ENV, useFactory: () => loadEnv() },
    ScopedRepository,

    { provide: APP_GUARD, useClass: ClsGuard },
    { provide: APP_GUARD, useClass: AuthGuard },
    { provide: APP_GUARD, useClass: BanGuard },
    { provide: APP_GUARD, useClass: ClsThrottlerGuard },

    { provide: APP_PIPE, useClass: ZodValidationPipe },

    { provide: APP_INTERCEPTOR, useClass: TelemetryInterceptor },
    { provide: APP_INTERCEPTOR, useClass: EnvelopeInterceptor },

    { provide: APP_FILTER, useClass: AllExceptionFilter },
  ],
  exports: [ENV, ScopedRepository, DrizzleModule],
})
export class CoreModule {}
