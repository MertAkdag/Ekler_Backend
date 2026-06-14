import { createZodDto } from 'nestjs-zod'
import { byDomainQuerySchema, courseListQuerySchema, suggestCourseBodySchema } from '@ekler/contracts'

export class ByDomainQueryDto extends createZodDto(byDomainQuerySchema) {}
export class CourseListQueryDto extends createZodDto(courseListQuerySchema) {}
export class SuggestCourseBodyDto extends createZodDto(suggestCourseBodySchema) {}
