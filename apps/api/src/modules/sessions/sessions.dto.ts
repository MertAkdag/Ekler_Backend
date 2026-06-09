import { createZodDto } from 'nestjs-zod'
import { sessionFeedQuerySchema } from '@ekler/contracts'

export class SessionFeedQueryDto extends createZodDto(sessionFeedQuerySchema) {}
