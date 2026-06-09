import { Module } from '@nestjs/common'
import { AuthController } from './auth.controller'
import { AuthService } from './auth.service'
import { OtpService } from './otp.service'
import { EmailProvider } from './email.provider'

/**
 * Own-auth (P8). TokenService is NOT listed here — it's provided + exported by the
 * @Global CoreModule so AuthGuard and AuthService share ONE singleton (keys
 * imported once at boot).
 */
@Module({
  controllers: [AuthController],
  providers: [AuthService, OtpService, EmailProvider],
})
export class AuthModule {}
