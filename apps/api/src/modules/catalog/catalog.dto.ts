import { createZodDto } from 'nestjs-zod'
import { byDomainQuerySchema, courseListQuerySchema } from '@ekler/contracts'

export class ByDomainQueryDto extends createZodDto(byDomainQuerySchema) {}
export class CourseListQueryDto extends createZodDto(courseListQuerySchema) {}
