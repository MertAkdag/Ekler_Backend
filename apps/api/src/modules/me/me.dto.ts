import { createZodDto } from 'nestjs-zod'
import {
  deviceTokenBodySchema,
  enrollCoursesBodySchema,
  grantConsentsBodySchema,
  presenceBodySchema,
  sisterUniversitiesBodySchema,
  updateProfileBodySchema,
  updateSettingsBodySchema,
  usernameAvailableQuerySchema,
} from '@ekler/contracts'

export class UpdateProfileBodyDto extends createZodDto(updateProfileBodySchema) {}
export class UsernameAvailableQueryDto extends createZodDto(usernameAvailableQuerySchema) {}
export class EnrollCoursesBodyDto extends createZodDto(enrollCoursesBodySchema) {}
export class UpdateSettingsBodyDto extends createZodDto(updateSettingsBodySchema) {}
export class PresenceBodyDto extends createZodDto(presenceBodySchema) {}
export class DeviceTokenBodyDto extends createZodDto(deviceTokenBodySchema) {}
export class GrantConsentsBodyDto extends createZodDto(grantConsentsBodySchema) {}
export class SisterUniversitiesBodyDto extends createZodDto(sisterUniversitiesBodySchema) {}
