import { Inject, Injectable } from '@nestjs/common'
import { and, asc, eq, ilike, or, sql } from 'drizzle-orm'
import type {
  Course,
  Department,
  Faculty,
  SuggestCourseBody,
  SuggestCourseResult,
  UniversityByDomain,
} from '@ekler/contracts'
import { DRIZZLE, type Db } from '../../db/drizzle.module'
import { ScopedRepository } from '../../db/scoped/scoped-repository'
import { courses } from '../../db/schema'
import { escapeLike } from '../../core/sql/escape-like'
import type { AuthPrincipal } from '../../core/cls/cls-store'

/**
 * Sentinel university_domain marking a course as GLOBAL — visible in every
 * university's catalog, not just one. An admin adds a shared course (e.g. a
 * common elective) by setting its university_domain to this value.
 */
const GLOBAL_COURSE_DOMAIN = '.edu.tr'

@Injectable()
export class CatalogService {
  constructor(
    @Inject(DRIZZLE) private readonly db: Db,
    private readonly scope: ScopedRepository,
  ) {}

  /** by-domain: passthrough of get_university_with_sisters + bundled faculties (kills onboarding N+1). */
  async universityByDomain(domain: string): Promise<UniversityByDomain> {
    const [uniRes, facRes] = await Promise.all([
      this.db.execute(sql`select public.get_university_with_sisters(${domain}) as j`),
      this.db.execute(sql`select id, name from public.get_faculties() order by name`),
    ])
    const j = ((uniRes as unknown as { rows: Array<{ j: unknown }> }).rows[0]?.j ?? {}) as {
      university?: UniversityByDomain['university']
      sister_universities?: UniversityByDomain['sister_universities']
    }
    return {
      university: j.university ?? null,
      sister_universities: j.sister_universities ?? [],
      faculties: (facRes as unknown as { rows: Faculty[] }).rows,
    }
  }

  /** All faculties (global catalog — get_faculties has no university filter). */
  async faculties(): Promise<Faculty[]> {
    const res = await this.db.execute(sql`select id, name from public.get_faculties() order by name`)
    return (res as unknown as { rows: Faculty[] }).rows
  }

  async departmentsByFaculty(facultyId: string): Promise<Department[]> {
    const res = await this.db.execute(
      sql`select id, name, faculty_id, duration_years from public.get_departments(${facultyId})`,
    )
    return (res as unknown as { rows: Department[] }).rows
  }

  /**
   * Courses for the caller's university (domain from CLS via the scope chokepoint),
   * id/code/name ordered by code — mirrors the RN useCourseCatalog fallback path.
   * No department filter: the live DB has no courses.department_id.
   */
  async courses(search?: string): Promise<Course[]> {
    const domain = this.scope.domain()
    // The caller's own courses PLUS any global course (GLOBAL_COURSE_DOMAIN),
    // which appears in every university's catalog.
    const where = [
      or(eq(courses.universityDomain, domain), eq(courses.universityDomain, GLOBAL_COURSE_DOMAIN))!,
    ]
    if (search) {
      const term = `%${escapeLike(search)}%`
      where.push(or(ilike(courses.code, term), ilike(courses.name, term))!)
    }
    return this.db
      .select({ id: courses.id, code: courses.code, name: courses.name })
      .from(courses)
      .where(and(...where))
      .orderBy(asc(courses.code))
  }

  /**
   * Crowdsource a missing course (wraps suggest_course — insert/endorse, auto-approve at
   * 3 via DB trigger). The RPC reads auth.uid(), so we set jwt-claims transaction-locally.
   * university_domain is the caller's (anti-K-1), never client-supplied.
   */
  async suggestCourse(input: SuggestCourseBody, user: AuthPrincipal): Promise<SuggestCourseResult> {
    const domain = this.scope.domain()
    const claims = JSON.stringify({ sub: user.userId, role: 'authenticated' })
    return this.db.transaction(async (tx) => {
      await tx.execute(sql`select set_config('request.jwt.claims', ${claims}, true)`)
      const res = (await tx.execute(
        sql`select public.suggest_course(${input.code}, ${input.name}, ${input.department_id}::uuid, ${domain}) as result`,
      )) as unknown as { rows: Array<{ result: SuggestCourseResult }> }
      return res.rows[0]?.result ?? { status: 'rate_limited' }
    })
  }
}
