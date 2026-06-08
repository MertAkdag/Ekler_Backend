import type { ClsStore } from 'nestjs-cls'

/**
 * Canonical request principal, resolved ONCE in AuthGuard and read everywhere
 * via CLS. `universityDomain` is the #1 anti-K-1 control — it is resolved from
 * `profiles` (alias-aware), NEVER trusted from the email/token.
 */
export interface AuthPrincipal {
  userId: string // = profiles.id = auth.users.id = JWT sub (same-UUID trick)
  universityDomain: string
  isAdmin: boolean
  isBanned: boolean // snapshot for UX; writes re-check via is_user_banned (SQL)
  isRestricted: boolean // snapshot; is_user_restricted (self-healing) is source of truth
  restrictionEndsAt: string | null
  tokenSource: 'supabase' | 'own'
}

export interface AppClsStore extends ClsStore {
  requestId: string
  principal?: AuthPrincipal
}
