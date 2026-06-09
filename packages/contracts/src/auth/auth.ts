import { z } from 'zod'
import { profileSchema } from '../me/profile'

const eduTrEmail = z
  .string()
  .trim()
  .toLowerCase()
  .email()
  .refine((e) => /^[^@\s]+@[^@\s]+\.edu\.tr$/.test(e), {
    message: 'Sadece .edu.tr uzantılı üniversite e-postaları kabul edilir.',
  })

export const requestOtpBodySchema = z.object({ email: eduTrEmail })
export type RequestOtpBody = z.infer<typeof requestOtpBodySchema>

export const verifyOtpBodySchema = z.object({
  email: eduTrEmail,
  code: z.string().regex(/^\d{6}$/, 'Kod 6 haneli olmalıdır.'),
})
export type VerifyOtpBody = z.infer<typeof verifyOtpBodySchema>

export const refreshBodySchema = z.object({
  refresh_token: z.string().min(1),
})
export type RefreshBody = z.infer<typeof refreshBodySchema>

export const authSessionSchema = z.object({
  access_token: z.string(),
  refresh_token: z.string(),
  token_type: z.literal('bearer'),
  expires_in: z.number().int(),
  user: profileSchema,
})
export type AuthSessionDto = z.infer<typeof authSessionSchema>
