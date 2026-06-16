import { Controller, Get, Param, Query } from '@nestjs/common'
import type { Department, Faculty, UniversityByDomain } from '@ekler/contracts'
import { Public } from '../../core/auth/public.decorator'
import { CatalogService } from './catalog.service'
import { ByDomainQueryDto, CatalogScopeQueryDto } from './catalog.dto'

@Controller()
export class CatalogController {
  constructor(private readonly catalog: CatalogService) {}

  /** Public catalog — used during onboarding before the profile is complete. */
  @Public()
  @Get('universities/by-domain')
  byDomain(@Query() q: ByDomainQueryDto): Promise<UniversityByDomain> {
    return this.catalog.universityByDomain(q.domain)
  }

  /**
   * Faculties available at a university (university_departments). With no
   * ?domain= (or no availability rows imported yet) falls back to the global
   * canonical list so onboarding never hard-blocks.
   */
  @Public()
  @Get('faculties')
  faculties(@Query() q: CatalogScopeQueryDto): Promise<Faculty[]> {
    return this.catalog.faculties(q.domain)
  }

  @Public()
  @Get('faculties/:id/departments')
  departments(
    @Param('id') facultyId: string,
    @Query() q: CatalogScopeQueryDto,
  ): Promise<Department[]> {
    return this.catalog.departmentsByFaculty(facultyId, q.domain)
  }
}
