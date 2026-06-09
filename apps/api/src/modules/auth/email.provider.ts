import { Inject, Injectable, Logger } from '@nestjs/common'
import { ENV, type Env } from '../../config/env'

/**
 * OTP email port. In DEV (no RESEND_API_KEY) it LOGS the code so the flow works
 * with zero external setup. In prod it POSTs to Resend's REST API (single fetch —
 * no SDK dependency).
 */
@Injectable()
export class EmailProvider {
  private readonly logger = new Logger('otp-email')

  constructor(@Inject(ENV) private readonly env: Env) {}

  async sendOtp(email: string, code: string): Promise<void> {
    const apiKey = this.env.RESEND_API_KEY
    const from = this.env.OTP_EMAIL_FROM ?? 'Ekler <onboarding@resend.dev>'

    if (!apiKey) {
      // DEV mode — make the code copy-pasteable from the API log.
      this.logger.warn(`[DEV OTP] ${email} → code ${code} (RESEND_API_KEY unset; email not sent)`)
      return
    }

    const res = await fetch('https://api.resend.com/emails', {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${apiKey}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        from,
        to: [email],
        subject: 'Ekler doğrulama kodun',
        text: `Doğrulama kodun: ${code}\n\nKod 10 dakika geçerlidir. Bu isteği sen yapmadıysan bu e-postayı yok say.`,
      }),
    })

    if (!res.ok) {
      const detail = await res.text().catch(() => '')
      this.logger.error(`Resend send failed (${res.status}): ${detail}`)
      throw new Error(`resend_failed_${res.status}`)
    }
  }
}
