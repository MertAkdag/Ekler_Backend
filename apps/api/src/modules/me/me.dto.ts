import { createZodDto } from 'nestjs-zod'
import {
  blockUserBodySchema,
  createAppealBodySchema,
  deviceTokenBodySchema,
  enrollCoursesBodySchema,
  grantConsentsBodySchema,
  isBlockedQuerySchema,
  presenceBodySchema,
  sisterUniversitiesBodySchema,
  updateProfileBodySchema,
  updateSettingsBodySchema,
  usernameAvailableQuerySchema,
  visibleUsersQuerySchema,
} from '@ekler/contracts'

export class UpdateProfileBodyDto extends createZodDto(updateProfileBodySchema) {}
export class UsernameAvailableQueryDto extends createZodDto(usernameAvailableQuerySchema) {}
export class EnrollCoursesBodyDto extends createZodDto(enrollCoursesBodySchema) {}
export class UpdateSettingsBodyDto extends createZodDto(updateSettingsBodySchema) {}
export class PresenceBodyDto extends createZodDto(presenceBodySchema) {}
export class DeviceTokenBodyDto extends createZodDto(deviceTokenBodySchema) {}
export class GrantConsentsBodyDto extends createZodDto(grantConsentsBodySchema) {}
export class SisterUniversitiesBodyDto extends createZodDto(sisterUniversitiesBodySchema) {}
export class CreateAppealBodyDto extends createZodDto(createAppealBodySchema) {}
export class VisibleUsersQueryDto extends createZodDto(visibleUsersQuerySchema) {}
export class BlockUserBodyDto extends createZodDto(blockUserBodySchema) {}
export class IsBlockedQueryDto extends createZodDto(isBlockedQuerySchema) {}
