import { createZodDto } from 'nestjs-zod'
import { eventFeedQuerySchema } from '@ekler/contracts'

export class EventFeedQueryDto extends createZodDto(eventFeedQuerySchema) {}
