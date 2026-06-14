import { Body, Controller, Delete, Get, HttpCode, Param, Patch, Post, Put, Query } from '@nestjs/common'
import type {
  Appeal,
  AppNotification,
  BlockedUser,
  Consent,
  IsBlockedResult,
  ProfileDetail,
  RequiredConsents,
  Sanction,
  UserCourse,
  UserSettings,
  UserStats,
  VisibleUser,
} from '@ekler/contracts'
import { CurrentUser } from '../../core/auth/public.decorator'
import type { AuthPrincipal } from '../../core/cls/cls-store'
import { MeService } from './me.service'
import {
  BlockUserBodyDto,
  CreateAppealBodyDto,
  DeviceTokenBodyDto,
  EnrollCoursesBodyDto,
  GrantConsentsBodyDto,
  IsBlockedQueryDto,
  PresenceBodyDto,
  SisterUniversitiesBodyDto,
  UpdateProfileBodyDto,
  UpdateSettingsBodyDto,
  UsernameAvailableQueryDto,
  VisibleUsersQueryDto,
} from './me.dto'

@Controller('me')
export class MeController {
  constructor(private readonly me: MeService) {}

  /** The authenticated user's profile (snake_case — drop-in for RN `Profile`). */
  @Get()
  profile(@CurrentUser() user: AuthPrincipal): Promise<ProfileDetail> {
    return this.me.profile(user)
  }

  /** Partial profile update (onboarding + profile edit). */
  @Patch()
  updateProfile(
    @CurrentUser() user: AuthPrincipal,
    @Body() body: UpdateProfileBodyDto,
  ): Promise<ProfileDetail> {
    return this.me.updateProfile(body, user)
  }

  /** Username availability check (onboarding). */
  @Get('username-available')
  usernameAvailable(
    @CurrentUser() user: AuthPrincipal,
    @Query() q: UsernameAvailableQueryDto,
  ): Promise<{ available: boolean }> {
    return this.me.usernameAvailable(q.username, user)
  }

  /** Profile header counts. */
  @Get('stats')
  stats(@CurrentUser() user: AuthPrincipal): Promise<UserStats> {
    return this.me.stats(user)
  }

  // ── Courses ──────────────────────────────────────────────────────────────
  @Get('courses')
  courses(@CurrentUser() user: AuthPrincipal): Promise<UserCourse[]> {
    return this.me.courses(user)
  }

  @Post('courses')
  @HttpCode(204)
  enrollCourses(
    @CurrentUser() user: AuthPrincipal,
    @Body() body: EnrollCoursesBodyDto,
  ): Promise<void> {
    return this.me.enrollCourses(body, user)
  }

  @Delete('courses/:courseId')
  @HttpCode(204)
  deleteCourse(
    @CurrentUser() user: AuthPrincipal,
    @Param('courseId') courseId: string,
  ): Promise<void> {
    return this.me.deleteCourse(courseId, user)
  }

  // ── Settings ─────────────────────────────────────────────────────────────
  @Get('settings')
  settings(@CurrentUser() user: AuthPrincipal): Promise<UserSettings> {
    return this.me.settings(user)
  }

  @Post('settings')
  updateSettings(
    @CurrentUser() user: AuthPrincipal,
    @Body() body: UpdateSettingsBodyDto,
  ): Promise<UserSettings> {
    return this.me.updateSettings(body, user)
  }

  // ── Presence ─────────────────────────────────────────────────────────────
  @Post('presence')
  @HttpCode(204)
  presence(@CurrentUser() user: AuthPrincipal, @Body() body: PresenceBodyDto): Promise<void> {
    return this.me.touchPresence(body.is_online, user)
  }

  // ── Device tokens (push delivery deferred; storage only) ─────────────────
  @Post('device-tokens')
  @HttpCode(204)
  registerDeviceToken(
    @CurrentUser() user: AuthPrincipal,
    @Body() body: DeviceTokenBodyDto,
  ): Promise<void> {
    return this.me.registerDeviceToken(body.expo_push_token, body.platform, user)
  }

  @Delete('device-tokens')
  @HttpCode(204)
  deleteDeviceToken(
    @CurrentUser() user: AuthPrincipal,
    @Query('token') token: string,
  ): Promise<void> {
    return this.me.deleteDeviceToken(token ?? '', user)
  }

  // ── Consents ─────────────────────────────────────────────────────────────
  @Get('consents')
  consents(@CurrentUser() user: AuthPrincipal): Promise<Consent[]> {
    return this.me.consents(user)
  }

  @Get('required-consents')
  requiredConsents(): RequiredConsents {
    return this.me.requiredConsents()
  }

  @Post('consents')
  @HttpCode(204)
  grantConsents(
    @CurrentUser() user: AuthPrincipal,
    @Body() body: GrantConsentsBodyDto,
  ): Promise<void> {
    return this.me.grantConsents(body.consent_types, user)
  }

  // ── Sister universities ──────────────────────────────────────────────────
  @Put('sister-universities')
  @HttpCode(204)
  replaceSisterUniversities(
    @CurrentUser() user: AuthPrincipal,
    @Body() body: SisterUniversitiesBodyDto,
  ): Promise<void> {
    return this.me.replaceSisterUniversities(body.domains, user)
  }

  // ── Notifications inbox (Wave E) ─────────────────────────────────────────
  @Get('notifications')
  notifications(@CurrentUser() user: AuthPrincipal): Promise<AppNotification[]> {
    return this.me.notifications(user)
  }

  @Patch('notifications')
  @HttpCode(204)
  markAllNotificationsRead(@CurrentUser() user: AuthPrincipal): Promise<void> {
    return this.me.markAllNotificationsRead(user)
  }

  @Patch('notifications/:id')
  @HttpCode(204)
  markNotificationRead(
    @CurrentUser() user: AuthPrincipal,
    @Param('id') id: string,
  ): Promise<void> {
    return this.me.markNotificationRead(id, user)
  }

  @Delete('notifications')
  @HttpCode(204)
  clearNotifications(@CurrentUser() user: AuthPrincipal): Promise<void> {
    return this.me.clearNotifications(user)
  }

  @Delete('notifications/:id')
  @HttpCode(204)
  deleteNotification(@CurrentUser() user: AuthPrincipal, @Param('id') id: string): Promise<void> {
    return this.me.deleteNotification(id, user)
  }

  // ── Sanctions + appeals (Wave E) ─────────────────────────────────────────
  @Get('sanctions')
  sanctions(@CurrentUser() user: AuthPrincipal): Promise<Sanction | null> {
    return this.me.activeSanction(user)
  }

  @Get('appeals')
  appeals(
    @CurrentUser() user: AuthPrincipal,
    @Query('sanction_id') sanctionId?: string,
  ): Promise<Appeal | null> {
    return this.me.latestAppeal(user, sanctionId)
  }

  @Post('appeals')
  @HttpCode(204)
  createAppeal(
    @CurrentUser() user: AuthPrincipal,
    @Body() body: CreateAppealBodyDto,
  ): Promise<void> {
    return this.me.createAppeal(body, user)
  }

  // ── Visible users (Wave E) ───────────────────────────────────────────────
  @Get('visible-users')
  visibleUsers(
    @CurrentUser() user: AuthPrincipal,
    @Query() q: VisibleUsersQueryDto,
  ): Promise<VisibleUser[]> {
    return this.me.visibleUsers(q.ids, user)
  }

  // ── Blocks (Apple App Review 1.2 UGC safety) ─────────────────────────────
  @Get('blocks')
  blocks(@CurrentUser() user: AuthPrincipal): Promise<BlockedUser[]> {
    return this.me.listBlocked(user)
  }

  @Get('blocks/check')
  isBlocked(
    @CurrentUser() user: AuthPrincipal,
    @Query() q: IsBlockedQueryDto,
  ): Promise<IsBlockedResult> {
    return this.me.isBlocked(q.other, user)
  }

  @Post('blocks')
  @HttpCode(204)
  blockUser(@CurrentUser() user: AuthPrincipal, @Body() body: BlockUserBodyDto): Promise<void> {
    return this.me.blockUser(body.blocked_id, body.reason ?? null, user)
  }

  @Delete('blocks/:blockedId')
  @HttpCode(204)
  unblockUser(
    @CurrentUser() user: AuthPrincipal,
    @Param('blockedId') blockedId: string,
  ): Promise<void> {
    return this.me.unblockUser(blockedId, user)
  }

  // ── GDPR (Wave F) — delete account + export data ──────────────────────────
  @Delete()
  @HttpCode(204)
  deleteAccount(@CurrentUser() user: AuthPrincipal): Promise<void> {
    return this.me.deleteAccount(user)
  }

  @Get('export')
  exportData(@CurrentUser() user: AuthPrincipal): Promise<Record<string, unknown>> {
    return this.me.exportData(user)
  }
}
