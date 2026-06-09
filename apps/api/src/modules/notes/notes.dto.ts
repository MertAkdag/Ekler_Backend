import { createZodDto } from 'nestjs-zod'
import { noteFeedQuerySchema, noteVoteBodySchema } from '@ekler/contracts'

export class NoteFeedQueryDto extends createZodDto(noteFeedQuerySchema) {}
export class NoteVoteBodyDto extends createZodDto(noteVoteBodySchema) {}
