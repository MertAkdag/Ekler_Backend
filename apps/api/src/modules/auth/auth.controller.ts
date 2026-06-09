import { Body, Controller, HttpCode, Post, Req } from '@nestjs/common'
import type { FastifyRequest } from 'fastify'
import { Public } from '../../core/auth/public.decorator'
import { RateLimit } from '../../core/throttler/rate-limits'
import { AuthService, type AuthSession } from './auth.service'
import { RequestOtpDto, VerifyOtpDto, RefreshDto } from './auth.dto'

@Controller('auth')
export class AuthController {
  constructor(private readonly auth: AuthService) {}

  private clientIp(req: FastifyRequest): string | null {
    return req.ip ?? null
  }
  private userAgent(req: FastifyRequest): string | null {
    const ua = req.headers['user-agent']
    return typeof ua === 'string' ? ua.slice(0, 512) : null
  }

  /** Send a 6-digit OTP to a `.edu.tr` email. Always 204 (anti-enumeration). */
  @Public()
  @Post('otp/request')
  @RateLimit('otpRequest')
  @HttpCode(204)
  async requestOtp(@Body() body: RequestOtpDto, @Req() req: FastifyRequest): Promise<void> {
    await this.auth.requestOtp(body.email, this.clientIp(req), this.userAgent(req))
  }

  /** Verify the code → find-or-create user → issue access + refresh tokens. */
  @Public()
  @Post('otp/verify')
  @RateLimit('otpVerify')
  async verifyOtp(@Body() body: VerifyOtpDto, @Req() req: FastifyRequest): Promise<AuthSession> {
    return this.auth.verifyOtp(body.email, body.code, this.clientIp(req), this.userAgent(req))
  }

  /** Rotate the refresh token (reuse → family revoke). */
  @Public()
  @Post('refresh')
  @RateLimit('refresh')
  async refresh(@Body() body: RefreshDto, @Req() req: FastifyRequest): Promise<AuthSession> {
    return this.auth.refresh(body.refresh_token, this.clientIp(req), this.userAgent(req))
  }

  /** Revoke the presented session (idempotent). */
  @Public()
  @Post('logout')
  @HttpCode(204)
  async logout(@Body() body: RefreshDto): Promise<void> {
    await this.auth.logout(body.refresh_token)
  }
}
