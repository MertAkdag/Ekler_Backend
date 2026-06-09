import { createZodDto } from 'nestjs-zod'
import { requestOtpBodySchema, verifyOtpBodySchema, refreshBodySchema } from '@ekler/contracts'

export class RequestOtpDto extends createZodDto(requestOtpBodySchema) {}
export class VerifyOtpDto extends createZodDto(verifyOtpBodySchema) {}
export class RefreshDto extends createZodDto(refreshBodySchema) {}
