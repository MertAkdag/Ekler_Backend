import { SetMetadata, createParamDecorator, type ExecutionContext } from '@nestjs/common'

/** Mark a route as not requiring authentication (skips AuthGuard + BanGuard). */
export const IS_PUBLIC_KEY = 'isPublic'
export const Public = () => SetMetadata(IS_PUBLIC_KEY, true)

/**
 * Inject the resolved `AuthPrincipal` into a handler param. Reads from CLS via
 * the request object stamped by AuthGuard.
 *   handler(@CurrentUser() user: AuthPrincipal) {}
 */
export const CurrentUser = createParamDecorator((_data: unknown, ctx: ExecutionContext) => {
  const req = ctx.switchToHttp().getRequest()
  return req.principal
})
