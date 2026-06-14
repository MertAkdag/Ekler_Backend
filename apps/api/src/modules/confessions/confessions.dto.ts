import { createZodDto } from 'nestjs-zod'
import {
  confessionCommentsQuerySchema,
  confessionFeedQuerySchema,
  createCommentBodySchema,
  createConfessionBodySchema,
  previewSubmissionBodySchema,
} from '@ekler/contracts'

export class ConfessionFeedQueryDto extends createZodDto(confessionFeedQuerySchema) {}
export class CreateConfessionBodyDto extends createZodDto(createConfessionBodySchema) {}
export class ConfessionCommentsQueryDto extends createZodDto(confessionCommentsQuerySchema) {}
export class CreateCommentBodyDto extends createZodDto(createCommentBodySchema) {}
export class PreviewSubmissionBodyDto extends createZodDto(previewSubmissionBodySchema) {}
