import { Controller, Get, Param, Query } from '@nestjs/common'
import type { Course, Department, Faculty, UniversityByDomain } from '@ekler/contracts'
import { Public } from '../../core/auth/public.decorator'
import { CatalogService } from './catalog.service'
import { ByDomainQueryDto, CourseListQueryDto } from './catalog.dto'

@Controller()
export class CatalogController {
  constructor(private readonly catalog: CatalogService) {}

  /** Public catalog — used during onboarding before the profile is complete. */
  @Public()
  @Get('universities/by-domain')
  byDomain(@Query() q: ByDomainQueryDto): Promise<UniversityByDomain> {
    return this.catalog.universityByDomain(q.domain)
  }

  @Public()
  @Get('faculties')
  faculties(): Promise<Faculty[]> {
    return this.catalog.faculties()
  }

  @Public()
  @Get('faculties/:id/departments')
  departments(@Param('id') facultyId: string): Promise<Department[]> {
    return this.catalog.departmentsByFaculty(facultyId)
  }

  /** Authenticated — scoped to the caller's university_domain. */
  @Get('courses')
  courses(@Query() q: CourseListQueryDto): Promise<Course[]> {
    return this.catalog.courses(q.search)
  }
}
