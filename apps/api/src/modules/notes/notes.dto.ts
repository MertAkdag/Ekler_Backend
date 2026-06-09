import { createZodDto } from 'nestjs-zod'
import { noteFeedQuerySchema } from '@ekler/contracts'

export class NoteFeedQueryDto extends createZodDto(noteFeedQuerySchema) {}
