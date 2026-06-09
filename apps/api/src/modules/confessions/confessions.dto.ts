import { createZodDto } from 'nestjs-zod'
import { confessionFeedQuerySchema, createConfessionBodySchema } from '@ekler/contracts'

export class ConfessionFeedQueryDto extends createZodDto(confessionFeedQuerySchema) {}
export class CreateConfessionBodyDto extends createZodDto(createConfessionBodySchema) {}
