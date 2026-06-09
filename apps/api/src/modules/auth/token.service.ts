import { Inject, Injectable, type OnModuleInit } from '@nestjs/common'
import {
  SignJWT,
  importPKCS8,
  importSPKI,
  jwtVerify,
  exportJWK,
  type KeyLike,
  type JWTPayload,
  type JWK,
} from 'jose'
import { createHash, randomBytes } from 'node:crypto'
import { ENV, type Env } from '../../config/env'

export const AUTH_ALG = 'EdDSA'
export const AUTH_ISSUER = 'ekler'
export const AUTH_AUDIENCE = 'ekler-app'
export const AUTH_KID = 'ek-ed25519-1'
/** kids the guard recognizes as ours (current + previous, for rotation). */
export const OWN_KIDS = new Set<string>([AUTH_KID])

export interface MintedAccess {
  token: string
  expiresIn: number
}

const normalizePem = (s: string): string => s.replace(/\\n/g, '\n')

/**
 * EdDSA (Ed25519) signer/verifier for our own access tokens, plus opaque
 * refresh-token generation + hashing. Keys are imported ONCE at boot and cached.
 * If AUTH_JWT_* are absent, own-signing is disabled (Supabase bridge still works).
 */
@Injectable()
export class TokenService implements OnModuleInit {
  private signingKey: KeyLike | null = null
  private verifyKey: KeyLike | null = null
  private publicJwk: JWK | null = null

  constructor(@Inject(ENV) private readonly env: Env) {}

  async onModuleInit(): Promise<void> {
    const priv = this.env.AUTH_JWT_PRIVATE_KEY
    const pub = this.env.AUTH_JWT_PUBLIC_KEY
    if (!priv || !pub) return // own-auth not configured yet → dual-accept falls back to Supabase
    this.signingKey = (await importPKCS8(normalizePem(priv), AUTH_ALG)) as KeyLike
    this.verifyKey = (await importSPKI(normalizePem(pub), AUTH_ALG)) as KeyLike
    const jwk = await exportJWK(this.verifyKey)
    this.publicJwk = { ...jwk, alg: AUTH_ALG, use: 'sig', kid: AUTH_KID }
  }

  /** True when AUTH_JWT_* are present and imported (own tokens can be minted/verified). */
  get enabled(): boolean {
    return this.signingKey !== null && this.verifyKey !== null
  }

  /** Public verification key (Ed25519 public) — used by AuthGuard for own-token verify. */
  getVerifyKey(): KeyLike | null {
    return this.verifyKey
  }

  /** JWKS for /.well-known/jwks.json (public key only, never `d`). */
  getJwks(): { keys: JWK[] } {
    return { keys: this.publicJwk ? [this.publicJwk] : [] }
  }

  /**
   * Mint an EdDSA access token. `sub`+`role` are REQUIRED so auth.uid()/auth.role()
   * (and the moderation set_config GUC) keep working unchanged.
   */
  async signAccess(params: {
    userId: string
    email: string
    universityDomain: string
  }): Promise<MintedAccess> {
    if (!this.signingKey) {
      throw new Error('TokenService: AUTH_JWT_PRIVATE_KEY not configured')
    }
    const ttl = this.env.AUTH_ACCESS_TTL
    const token = await new SignJWT({
      role: 'authenticated', // auth.role() + moderation set_config({sub,role})
      email: params.email,
      university_domain: params.universityDomain, // convenience only; non-authoritative
    })
      .setProtectedHeader({ alg: AUTH_ALG, kid: AUTH_KID, typ: 'JWT' })
      .setSubject(params.userId) // sub == profiles.id == auth.users.id
      .setIssuer(AUTH_ISSUER)
      .setAudience(AUTH_AUDIENCE)
      .setIssuedAt()
      .setExpirationTime(`${ttl}s`) // relative string; a NUMBER would be an absolute epoch
      .sign(this.signingKey)
    return { token, expiresIn: ttl }
  }

  /** Verify an own EdDSA token. Pinned alg/iss/aud. Throws on any failure. */
  async verifyAccess(token: string): Promise<JWTPayload> {
    if (!this.verifyKey) throw new Error('TokenService: verify key not configured')
    const { payload } = await jwtVerify(token, this.verifyKey, {
      algorithms: [AUTH_ALG], // CRITICAL: only EdDSA — locks out alg confusion
      issuer: AUTH_ISSUER,
      audience: AUTH_AUDIENCE,
    })
    return payload
  }

  /** Opaque 256-bit refresh token (base64url) — NOT a JWT. */
  generateRefreshToken(): string {
    return randomBytes(32).toString('base64url')
  }

  /** sha256 of the opaque token → raw 32-byte Buffer (stored as bytea). */
  hashRefreshToken(token: string): Buffer {
    return createHash('sha256').update(token).digest()
  }
}
