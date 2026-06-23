import { SetMetadata, createParamDecorator, type ExecutionContext } from '@nestjs/common'

/** Mark a route as not requiring authentication (skips AuthGuard + BanGuard). */
export const IS_PUBLIC_KEY = 'isPublic'
export const Public = () => SetMetadata(IS_PUBLIC_KEY, true)

/**
 * Mark an authenticated write route as reachable by banned/restricted users.
 * BanGuard skips the ban/restriction check (but AuthGuard still runs — a valid
 * principal is required). Use ONLY for rights/legal/safety/housekeeping writes a
 * banned user is still entitled to: recording/withdrawing consent (KVKK/GDPR),
 * GDPR account delete, filing a ban appeal, presence heartbeat, own-notification
 * housekeeping, device-token (de)registration, blocking/unblocking other users.
 * NEVER apply to content-producing routes.
 */
export const ALLOW_BANNED_KEY = 'allowBanned'
export const AllowBanned = () => SetMetadata(ALLOW_BANNED_KEY, true)

/**
 * Inject the resolved `AuthPrincipal` into a handler param. Reads from CLS via
 * the request object stamped by AuthGuard.
 *   handler(@CurrentUser() user: AuthPrincipal) {}
 */
export const CurrentUser = createParamDecorator((_data: unknown, ctx: ExecutionContext) => {
  const req = ctx.switchToHttp().getRequest()
  return req.principal
})
