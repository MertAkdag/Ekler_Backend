import { createZodDto } from 'nestjs-zod'
import { signPathsBodySchema, uploadUrlBodySchema } from '@ekler/contracts'

export class SignPathsDto extends createZodDto(signPathsBodySchema) {}
export class UploadUrlDto extends createZodDto(uploadUrlBodySchema) {}
