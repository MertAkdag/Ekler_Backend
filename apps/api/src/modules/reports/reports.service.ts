import { Inject, Injectable } from '@nestjs/common'
import { and, eq, sql } from 'drizzle-orm'
import type { CreateReportBody, ReportTargetType } from '@ekler/contracts'
import { DRIZZLE, type Db } from '../../db/drizzle.module'
import { ScopedRepository } from '../../db/scoped/scoped-repository'
import { confessionComments, confessions, notes, profiles, reports } from '../../db/schema'
import { AppError } from '../../core/errors/app-error'
import type { AuthPrincipal } from '../../core/cls/cls-store'

/**
 * Polymorphic content reports. The report row itself isn't university-scoped, but its
 * TARGET is: a caller may only report content in their own university. We verify the
 * target exists in-scope (per target_type) before inserting — a cross-uni or unknown
 * target → 404 (never reveals out-of-scope existence). reporter_id is stamped from the
 * principal; the UNIQUE(target_type, target_id, reporter) duplicate → 409.
 */
@Injectable()
export class ReportsService {
  constructor(
    @Inject(DRIZZLE) private readonly db: Db,
    private readonly scope: ScopedRepository,
  ) {}

  async create(body: CreateReportBody, user: AuthPrincipal): Promise<void> {
    const domain = this.scope.domain()
    const uid = user.userId

    await this.requireTargetInScope(body.target_type, body.target_id, domain)

    try {
      await this.db.insert(reports).values({
        targetType: body.target_type,
        targetId: body.target_id,
        reporterId: uid,
        reason: body.reason,
        description: body.description,
        source: 'app',
      })
    } catch (err) {
      const code =
        (err as { cause?: { code?: string } })?.cause?.code ?? (err as { code?: string })?.code
      if (code === '23505') {
        throw new AppError('CONFLICT', 'Bunu daha önce bildirdin.')
      }
      throw err
    }
  }

  /** Polymorphic anti-K-1: the report target must live in the caller's university. */
  private async requireTargetInScope(
    targetType: ReportTargetType,
    targetId: string,
    domain: string,
  ): Promise<void> {
    const id = sql`${targetId}::uuid`
    let rows: Array<{ x: number }> = []

    if (targetType === 'confession') {
      rows = await this.db
        .select({ x: sql<number>`1` })
        .from(confessions)
        .where(and(eq(confessions.universityDomain, domain), sql`${confessions.id} = ${id}`))
        .limit(1)
    } else if (targetType === 'note') {
      rows = await this.db
        .select({ x: sql<number>`1` })
        .from(notes)
        .where(and(eq(notes.universityDomain, domain), sql`${notes.id} = ${id}`))
        .limit(1)
    } else if (targetType === 'comment') {
      rows = await this.db
        .select({ x: sql<number>`1` })
        .from(confessionComments)
        .innerJoin(confessions, eq(confessions.id, confessionComments.confessionId))
        .where(and(eq(confessions.universityDomain, domain), sql`${confessionComments.id} = ${id}`))
        .limit(1)
    } else {
      // user
      rows = await this.db
        .select({ x: sql<number>`1` })
        .from(profiles)
        .where(and(eq(profiles.universityDomain, domain), sql`${profiles.id} = ${id}`))
        .limit(1)
    }

    if (rows.length === 0) {
      throw new AppError('NOT_FOUND', 'Bildirilecek içerik bulunamadı.')
    }
  }
}
