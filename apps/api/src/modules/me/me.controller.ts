import { Controller, Get, Inject } from '@nestjs/common'
import { eq } from 'drizzle-orm'
import type { Profile } from '@ekler/contracts'
import { CurrentUser } from '../../core/auth/public.decorator'
import type { AuthPrincipal } from '../../core/cls/cls-store'
import { AppError } from '../../core/errors/app-error'
import { DRIZZLE, type Db } from '../../db/drizzle.module'
import { profiles } from '../../db/schema'

@Controller('me')
export class MeController {
  constructor(@Inject(DRIZZLE) private readonly db: Db) {}

  /** The authenticated user's profile (snake_case — drop-in for RN `Profile`). */
  @Get()
  async me(@CurrentUser() user: AuthPrincipal): Promise<Profile> {
    const [row] = await this.db
      .select({
        id: profiles.id,
        full_name: profiles.fullName,
        username: profiles.username,
        avatar_url: profiles.avatarUrl,
        university_domain: profiles.universityDomain,
        faculty: profiles.faculty,
        department: profiles.department,
        is_admin: profiles.isAdmin,
        is_banned: profiles.isBanned,
        is_restricted: profiles.isRestricted,
        restriction_ends_at: profiles.restrictionEndsAt,
      })
      .from(profiles)
      .where(eq(profiles.id, user.userId))
      .limit(1)

    if (!row) throw new AppError('NOT_FOUND', 'Profile not found.')
    return row
  }
}
