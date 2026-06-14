import { createZodDto } from 'nestjs-zod'
import {
  createNoteBodySchema,
  createNoteCommentBodySchema,
  noteCommentsQuerySchema,
  noteFeedQuerySchema,
  noteVoteBodySchema,
} from '@ekler/contracts'

export class NoteFeedQueryDto extends createZodDto(noteFeedQuerySchema) {}
export class NoteVoteBodyDto extends createZodDto(noteVoteBodySchema) {}
export class CreateNoteBodyDto extends createZodDto(createNoteBodySchema) {}
export class NoteCommentsQueryDto extends createZodDto(noteCommentsQuerySchema) {}
export class CreateNoteCommentBodyDto extends createZodDto(createNoteCommentBodySchema) {}
