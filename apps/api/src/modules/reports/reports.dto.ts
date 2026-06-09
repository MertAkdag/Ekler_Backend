import { createZodDto } from 'nestjs-zod'
import { createReportBodySchema } from '@ekler/contracts'

export class CreateReportBodyDto extends createZodDto(createReportBodySchema) {}
