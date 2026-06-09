import { createZodDto } from 'nestjs-zod'
import { createSessionBodySchema, sessionFeedQuerySchema } from '@ekler/contracts'

export class SessionFeedQueryDto extends createZodDto(sessionFeedQuerySchema) {}
export class CreateSessionBodyDto extends createZodDto(createSessionBodySchema) {}
