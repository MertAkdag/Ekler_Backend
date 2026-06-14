import { Body, Controller, Get, Param, Post, Query } from '@nestjs/common'
import type {
  Course,
  Department,
  Faculty,
  SuggestCourseResult,
  UniversityByDomain,
} from '@ekler/contracts'
import { CurrentUser, Public } from '../../core/auth/public.decorator'
import type { AuthPrincipal } from '../../core/cls/cls-store'
import { RateLimit } from '../../core/throttler/rate-limits'
import { CatalogService } from './catalog.service'
import { ByDomainQueryDto, CourseListQueryDto, SuggestCourseBodyDto } from './catalog.dto'

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

  /** Crowdsource a missing course (suggest_course; auto-approve at 3 endorsements). */
  @Post('courses/suggest')
  @RateLimit('courseSuggest')
  suggestCourse(
    @CurrentUser() user: AuthPrincipal,
    @Body() body: SuggestCourseBodyDto,
  ): Promise<SuggestCourseResult> {
    return this.catalog.suggestCourse(body, user)
  }
}
