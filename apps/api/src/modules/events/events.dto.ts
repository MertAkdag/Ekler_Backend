import { createZodDto } from 'nestjs-zod'
import { eventFeedQuerySchema, logEventBodySchema } from '@ekler/contracts'

export class EventFeedQueryDto extends createZodDto(eventFeedQuerySchema) {}
export class LogEventBodyDto extends createZodDto(logEventBodySchema) {}
