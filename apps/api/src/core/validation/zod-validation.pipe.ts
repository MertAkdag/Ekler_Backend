import { createZodValidationPipe } from 'nestjs-zod'
import type { ZodError } from 'zod'
import { AppError } from '../errors/app-error'

/**
 * Global Zod validation pipe. Default nestjs-zod throws a 400; we override the
 * exception so validation failures surface as our canonical 422 envelope.
 * (nestjs-zod v5 types the creator arg as `unknown`; it is always a ZodError.)
 */
export const ZodValidationPipe = createZodValidationPipe({
  createValidationException: (error) => {
    const zodError = error as ZodError
    return new AppError('VALIDATION_FAILED', 'Request validation failed', {
      issues: zodError.issues.map((i) => ({
        path: i.path.join('.'),
        message: i.message,
        code: i.code,
      })),
    })
  },
})
