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

export interface MintedAccess {
  token: string
  expiresIn: number
}

const normalizePem = (s: string): string => s.replace(/\\n/g, '\n')

/**
 * EdDSA (Ed25519) signer/verifier for our own access tokens, plus opaque
 * refresh-token generation + hashing. Keys are imported ONCE at boot and cached.
 * If AUTH_JWT_* are absent, own-signing is disabled (Supabase bridge still works).
 *
 * Key rotation: we ALWAYS sign with the current key (`signingKid`), but verify
 * against a kid→key map that may also hold one previous (verify-only) key so
 * tokens signed just before a rotation keep working until they expire. The JWKS
 * publishes every public key in the map.
 */
@Injectable()
export class TokenService implements OnModuleInit {
  private signingKey: KeyLike | null = null
  private signingKid = ''
  /** kid → public verify key (current + optional previous). */
  private readonly verifyKeys = new Map<string, KeyLike>()
  private publicJwks: JWK[] = []

  constructor(@Inject(ENV) private readonly env: Env) {}

  async onModuleInit(): Promise<void> {
    const priv = this.env.AUTH_JWT_PRIVATE_KEY
    const pub = this.env.AUTH_JWT_PUBLIC_KEY
    if (!priv || !pub) return // own-auth not configured yet → dual-accept falls back to Supabase

    this.signingKid = this.env.AUTH_JWT_KID
    this.signingKey = (await importPKCS8(normalizePem(priv), AUTH_ALG)) as KeyLike
    await this.registerVerifyKey(this.signingKid, pub)

    // Optional previous key (verify-only) for a rotation overlap. Both-or-neither.
    const prevPub = this.env.AUTH_JWT_PUBLIC_KEY_PREV
    const prevKid = this.env.AUTH_JWT_KID_PREV
    if (prevPub && prevKid && prevKid !== this.signingKid) {
      await this.registerVerifyKey(prevKid, prevPub)
    }
  }

  private async registerVerifyKey(kid: string, spki: string): Promise<void> {
    const key = (await importSPKI(normalizePem(spki), AUTH_ALG)) as KeyLike
    this.verifyKeys.set(kid, key)
    const jwk = await exportJWK(key)
    this.publicJwks.push({ ...jwk, alg: AUTH_ALG, use: 'sig', kid })
  }

  /** True when AUTH_JWT_* are present and imported (own tokens can be minted/verified). */
  get enabled(): boolean {
    return this.signingKey !== null
  }

  /** Whether `kid` belongs to us (current or a still-accepted previous key). */
  isOwnKid(kid: string | undefined): boolean {
    return kid !== undefined && this.verifyKeys.has(kid)
  }

  /** JWKS for /.well-known/jwks.json (public keys only, never `d`). */
  getJwks(): { keys: JWK[] } {
    return { keys: this.publicJwks }
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
      .setProtectedHeader({ alg: AUTH_ALG, kid: this.signingKid, typ: 'JWT' })
      .setSubject(params.userId) // sub == profiles.id == auth.users.id
      .setIssuer(AUTH_ISSUER)
      .setAudience(AUTH_AUDIENCE)
      .setIssuedAt()
      .setExpirationTime(`${ttl}s`) // relative string; a NUMBER would be an absolute epoch
      .sign(this.signingKey)
    return { token, expiresIn: ttl }
  }

  /**
   * Verify an own EdDSA token. The key is selected by the token's kid from our
   * verify map (current or previous), so a token minted before a rotation still
   * validates. Pinned alg/iss/aud. Throws on any failure (unknown kid included).
   */
  async verifyAccess(token: string): Promise<JWTPayload> {
    if (this.verifyKeys.size === 0) throw new Error('TokenService: verify key not configured')
    const { payload } = await jwtVerify(
      token,
      (header) => {
        const key = header.kid !== undefined ? this.verifyKeys.get(header.kid) : undefined
        if (!key) throw new Error(`TokenService: unknown kid ${String(header.kid)}`)
        return key
      },
      {
        algorithms: [AUTH_ALG], // CRITICAL: only EdDSA — locks out alg confusion
        issuer: AUTH_ISSUER,
        audience: AUTH_AUDIENCE,
      },
    )
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
