import { Inject, Injectable } from '@nestjs/common'
import { sql } from 'drizzle-orm'
import type { Department, Faculty, UniversityByDomain } from '@ekler/contracts'
import { DRIZZLE, type Db } from '../../db/drizzle.module'

@Injectable()
export class CatalogService {
  constructor(@Inject(DRIZZLE) private readonly db: Db) {}

  /** by-domain: passthrough of get_university_with_sisters + bundled faculties (kills onboarding N+1). */
  async universityByDomain(domain: string): Promise<UniversityByDomain> {
    const [uniRes, faculties] = await Promise.all([
      this.db.execute(sql`select public.get_university_with_sisters(${domain}) as j`),
      this.faculties(domain),
    ])
    const j = ((uniRes as unknown as { rows: Array<{ j: unknown }> }).rows[0]?.j ?? {}) as {
      university?: UniversityByDomain['university']
      sister_universities?: UniversityByDomain['sister_universities']
    }
    return {
      university: j.university ?? null,
      sister_universities: j.sister_universities ?? [],
      faculties,
    }
  }

  /**
   * Faculties available at a university (university_departments). When no domain
   * is given, or no availability rows have been imported yet for it, falls back
   * to the global canonical list so onboarding never hard-blocks.
   */
  async faculties(domain?: string): Promise<Faculty[]> {
    if (domain) {
      const res = await this.db.execute(sql`
        select distinct f.id, f.name
        from public.university_departments ud
        join public.faculties f on f.id = ud.faculty_id
        where ud.university_domain = ${domain}
        order by f.name
      `)
      const rows = (res as unknown as { rows: Faculty[] }).rows
      if (rows.length) return rows
    }
    const res = await this.db.execute(sql`select id, name from public.get_faculties() order by name`)
    return (res as unknown as { rows: Faculty[] }).rows
  }

  /**
   * Departments available at a university for a faculty, carrying per-university
   * prep_mode + medium. Falls back to the global canonical list (prep_mode/medium
   * null) when no domain or no availability rows exist for it.
   */
  async departmentsByFaculty(facultyId: string, domain?: string): Promise<Department[]> {
    if (domain) {
      const res = await this.db.execute(sql`
        select d.id, d.name, d.faculty_id, d.duration_years, ud.prep_mode, ud.medium
        from public.university_departments ud
        join public.departments d on d.id = ud.department_id
        where ud.university_domain = ${domain} and ud.faculty_id = ${facultyId}
        order by d.name
      `)
      const rows = (res as unknown as { rows: Department[] }).rows
      if (rows.length) return rows
    }
    const res = await this.db.execute(
      sql`select id, name, faculty_id, duration_years from public.get_departments(${facultyId})`,
    )
    return (res as unknown as { rows: Department[] }).rows
  }
}
