import { Inject, Injectable } from '@nestjs/common'
import { ClsService } from 'nestjs-cls'
import { eq, type SQL } from 'drizzle-orm'
import type { AnyPgColumn } from 'drizzle-orm/pg-core'
import { AppError } from '../../core/errors/app-error'
import type { AppClsStore } from '../../core/cls/cls-store'
import { DRIZZLE, type Db } from '../drizzle.module'

/**
 * THE university-scope chokepoint (anti-K-1).
 *
 * Every read/write against a scoped table must route its tenancy filter through
 * here. `domain()` is fail-closed: if no principal scope is in CLS the request
 * dies with UNIVERSITY_SCOPE_MISSING (a 500 — it must never reach a client; it
 * means a route slipped past AuthGuard while touching scoped data).
 *
 * Concrete per-domain repositories (Phase 2) compose `scopeFilter`/`stamp` into
 * their Drizzle queries. Child tables without a `university_domain` column
 * (likes/bookmarks/votes/comments/participants/members) are reached only via
 * parent-scoped accessors that prove the parent is in-domain (mirrors the RLS
 * `EXISTS` policies).
 */
@Injectable()
export class ScopedRepository {
  constructor(
    @Inject(DRIZZLE) readonly db: Db,
    private readonly cls: ClsService<AppClsStore>,
  ) {}

  /** Caller's university_domain, or fail-closed. */
  domain(): string {
    const domain = this.cls.get('principal')?.universityDomain
    if (!domain) {
      throw new AppError(
        'UNIVERSITY_SCOPE_MISSING',
        'University scope absent from request context — a scoped query ran outside an authenticated, scoped request.',
      )
    }
    return domain
  }

  /** `eq(column, <caller domain>)` — AND this into every scoped SELECT/UPDATE/DELETE. */
  scopeFilter(universityDomainColumn: AnyPgColumn): SQL {
    return eq(universityDomainColumn, this.domain())
  }

  /** Force the caller's domain onto an INSERT payload, ignoring any caller-supplied value. */
  stamp<T extends Record<string, unknown>>(values: T): T & { universityDomain: string } {
    return { ...values, universityDomain: this.domain() }
  }
}
