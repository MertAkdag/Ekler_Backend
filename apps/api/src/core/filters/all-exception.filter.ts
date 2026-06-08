import {
  ArgumentsHost,
  Catch,
  ExceptionFilter,
  HttpException,
  Logger,
} from '@nestjs/common'
import { ThrottlerException } from '@nestjs/throttler'
import { ClsService } from 'nestjs-cls'
import type { FastifyReply } from 'fastify'
import type { ErrorBody, ErrorCode } from '@ekler/contracts'
import { AppError, ERROR_STATUS } from '../errors/app-error'
import type { AppClsStore } from '../cls/cls-store'

/**
 * Single exit point for every error → canonical `{ error: { code, message, details } }`
 * envelope with the mapped HTTP status. Translates AppError, ThrottlerException,
 * HttpException, and unknown throwables. Never leaks internals on a 500.
 */
@Catch()
export class AllExceptionFilter implements ExceptionFilter {
  private readonly logger = new Logger('exception')

  constructor(private readonly cls: ClsService<AppClsStore>) {}

  catch(exception: unknown, host: ArgumentsHost): void {
    const reply = host.switchToHttp().getResponse<FastifyReply>()
    const { status, body, isServer } = this.translate(exception)

    if (isServer) {
      this.logger.error(
        JSON.stringify({ requestId: this.cls.get('requestId'), code: body.error.code }),
        exception instanceof Error ? exception.stack : String(exception),
      )
    }

    void reply.status(status).send(body)
  }

  private translate(exception: unknown): {
    status: number
    body: ErrorBody
    isServer: boolean
  } {
    if (exception instanceof AppError) {
      const status = ERROR_STATUS[exception.code]
      return {
        status,
        body: { error: { code: exception.code, message: exception.message, details: exception.details } },
        isServer: status >= 500,
      }
    }

    if (exception instanceof ThrottlerException) {
      return {
        status: 429,
        body: { error: { code: 'RATE_LIMIT_EXCEEDED', message: 'Too many requests.' } },
        isServer: false,
      }
    }

    if (exception instanceof HttpException) {
      const status = exception.getStatus()
      return {
        status,
        body: { error: { code: this.codeForStatus(status), message: exception.message } },
        isServer: status >= 500,
      }
    }

    return {
      status: 500,
      body: { error: { code: 'INTERNAL', message: 'Internal server error.' } },
      isServer: true,
    }
  }

  private codeForStatus(status: number): ErrorCode {
    switch (status) {
      case 401:
        return 'UNAUTHENTICATED'
      case 403:
        return 'FORBIDDEN'
      case 404:
        return 'NOT_FOUND'
      case 409:
        return 'CONFLICT'
      case 410:
        return 'ACCOUNT_QUARANTINED'
      case 422:
        return 'VALIDATION_FAILED'
      case 429:
        return 'RATE_LIMIT_EXCEEDED'
      default:
        return status >= 500 ? 'INTERNAL' : 'FORBIDDEN'
    }
  }
}
