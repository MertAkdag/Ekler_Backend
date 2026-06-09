import { createZodDto } from 'nestjs-zod'
import { confessionFeedQuerySchema } from '@ekler/contracts'

export class ConfessionFeedQueryDto extends createZodDto(confessionFeedQuerySchema) {}
