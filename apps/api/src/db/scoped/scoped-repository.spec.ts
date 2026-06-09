import { describe, it, expect } from 'vitest'
import { PgDialect } from 'drizzle-orm/pg-core'
import type { ClsService } from 'nestjs-cls'
import { ScopedRepository } from './scoped-repository'
import { AppError } from '../../core/errors/app-error'
import type { AppClsStore, AuthPrincipal } from '../../core/cls/cls-store'
import type { Db } from '../drizzle.module'
import { confessions } from '../schema'

/**
 * Unit tests for THE anti-K-1 chokepoint. No DB connection — ScopedRepository
 * only reads the CLS principal and composes SQL, so a fake CLS + a never-touched
 * `db` stub cover the whole surface.
 */

const dialect = new PgDialect()

/** Build a repo whose CLS returns the given principal (or none). */
function makeRepo(principal?: Partial<AuthPrincipal>): ScopedRepository {
  const cls = {
    get: (key: string) => (key === 'principal' ? principal : undefined),
  } as unknown as ClsService<AppClsStore>
  // db is never dereferenced by the methods under test.
  return new ScopedRepository({} as Db, cls)
}

describe('ScopedRepository.domain() — fail-closed', () => {
  it('returns the principal university_domain when present', () => {
    expect(makeRepo({ universityDomain: 'a.edu.tr' }).domain()).toBe('a.edu.tr')
  })

  it('throws UNIVERSITY_SCOPE_MISSING when there is no principal', () => {
    const err = (() => {
      try {
        makeRepo(undefined).domain()
      } catch (e) {
        return e
      }
    })()
    expect(err).toBeInstanceOf(AppError)
    expect((err as AppError).code).toBe('UNIVERSITY_SCOPE_MISSING')
  })

  it('throws when the principal exists but its domain is empty', () => {
    expect(() => makeRepo({ universityDomain: '' }).domain()).toThrowError(AppError)
  })
})

describe('ScopedRepository.scopeFilter() — AND-injected tenancy filter', () => {
  it('produces `<column> = <caller domain>` with the domain as a bound param', () => {
    const repo = makeRepo({ universityDomain: 'a.edu.tr' })
    const { sql, params } = dialect.sqlToQuery(repo.scopeFilter(confessions.universityDomain))
    expect(sql).toContain('university_domain')
    expect(params).toContain('a.edu.tr')
  })

  it('fails closed when no scope is present', () => {
    expect(() => makeRepo(undefined).scopeFilter(confessions.universityDomain)).toThrowError(
      AppError,
    )
  })
})

describe('ScopedRepository.stamp() — INSERT tenancy stamp', () => {
  it('forces the caller domain, ignoring any caller-supplied value', () => {
    const repo = makeRepo({ universityDomain: 'a.edu.tr' })
    const stamped = repo.stamp({ body: 'hi', universityDomain: 'evil.edu.tr' })
    expect(stamped).toEqual({ body: 'hi', universityDomain: 'a.edu.tr' })
  })

  it('fails closed when no scope is present', () => {
    expect(() => makeRepo(undefined).stamp({ body: 'hi' })).toThrowError(AppError)
  })
})
