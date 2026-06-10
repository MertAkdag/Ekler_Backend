import { describe, it, expect, beforeAll } from 'vitest'
import { SignJWT, exportPKCS8, exportSPKI, generateKeyPair } from 'jose'
import { TokenService, AUTH_ALG, AUTH_ISSUER, AUTH_AUDIENCE } from './token.service'
import type { Env } from '../../config/env'

/**
 * Pure-crypto unit tests for the own-token signer/verifier. No DB, no Nest — the
 * service just imports keys and signs/verifies. Covers the security-load-bearing
 * bits the audit flagged as untested: alg-confusion pinning, unknown-kid
 * rejection, and verify-during-key-rotation.
 */

interface Keypair {
  kid: string
  privPem: string
  pubPem: string
}

async function makeKeypair(kid: string): Promise<Keypair> {
  const { privateKey, publicKey } = await generateKeyPair(AUTH_ALG, { extractable: true })
  return { kid, privPem: await exportPKCS8(privateKey), pubPem: await exportSPKI(publicKey) }
}

/** Build + boot a TokenService for the given signing key (+ optional previous verify-only key). */
async function makeService(signing: Keypair, prev?: Keypair): Promise<TokenService> {
  const env = {
    AUTH_JWT_PRIVATE_KEY: signing.privPem,
    AUTH_JWT_PUBLIC_KEY: signing.pubPem,
    AUTH_JWT_KID: signing.kid,
    AUTH_JWT_PUBLIC_KEY_PREV: prev?.pubPem,
    AUTH_JWT_KID_PREV: prev?.kid,
    AUTH_ACCESS_TTL: 900,
  } as unknown as Env
  const svc = new TokenService(env)
  await svc.onModuleInit()
  return svc
}

const CLAIMS = { userId: '11111111-1111-1111-1111-111111111111', email: 'a@x.edu.tr', universityDomain: 'x.edu.tr' }

describe('TokenService — configuration', () => {
  it('is disabled (no signing) when AUTH_JWT_* are absent', async () => {
    const svc = new TokenService({ AUTH_JWT_KID: 'k' } as unknown as Env)
    await svc.onModuleInit()
    expect(svc.enabled).toBe(false)
    expect(svc.getJwks().keys).toHaveLength(0)
  })
})

describe('TokenService — sign/verify roundtrip', () => {
  let kp: Keypair
  let svc: TokenService
  beforeAll(async () => {
    kp = await makeKeypair('ek-ed25519-1')
    svc = await makeService(kp)
  })

  it('mints a token that verifies, carrying sub/role/iss/aud', async () => {
    const { token } = await svc.signAccess(CLAIMS)
    const payload = await svc.verifyAccess(token)
    expect(payload.sub).toBe(CLAIMS.userId)
    expect(payload.role).toBe('authenticated')
    expect(payload.iss).toBe(AUTH_ISSUER)
    expect(payload.aud).toBe(AUTH_AUDIENCE)
  })

  it('publishes a public-only JWKS (no private `d`) with the signing kid', () => {
    const { keys } = svc.getJwks()
    expect(keys).toHaveLength(1)
    expect(keys[0]?.kid).toBe('ek-ed25519-1')
    expect(keys[0]).not.toHaveProperty('d')
  })

  it('recognizes its own kid and rejects foreign kids', () => {
    expect(svc.isOwnKid('ek-ed25519-1')).toBe(true)
    expect(svc.isOwnKid('supabase')).toBe(false)
    expect(svc.isOwnKid(undefined)).toBe(false)
  })
})

describe('TokenService — security pinning', () => {
  it('rejects an HS256 token even when it claims our kid (alg-confusion)', async () => {
    const kp = await makeKeypair('ek-ed25519-1')
    const svc = await makeService(kp)
    const forged = await new SignJWT({ role: 'authenticated' })
      .setProtectedHeader({ alg: 'HS256', kid: 'ek-ed25519-1' })
      .setSubject('attacker')
      .setIssuer(AUTH_ISSUER)
      .setAudience(AUTH_AUDIENCE)
      .setIssuedAt()
      .setExpirationTime('900s')
      .sign(new TextEncoder().encode('whatever-secret'))
    await expect(svc.verifyAccess(forged)).rejects.toThrow()
  })

  it('rejects a valid-signature token minted by a key we do not hold', async () => {
    const ours = await makeService(await makeKeypair('ek-ed25519-1'))
    const stranger = await makeService(await makeKeypair('stranger-kid'))
    const { token } = await stranger.signAccess(CLAIMS)
    await expect(ours.verifyAccess(token)).rejects.toThrow()
  })

  it('rejects a token whose kid is not in our verify map', async () => {
    const ours = await makeService(await makeKeypair('ek-ed25519-1'))
    // Same crypto material as ours, but a kid header we never registered.
    const otherKid = await makeKeypair('ek-ed25519-99')
    const signer = await makeService(otherKid)
    const { token } = await signer.signAccess(CLAIMS)
    expect(ours.isOwnKid('ek-ed25519-99')).toBe(false)
    await expect(ours.verifyAccess(token)).rejects.toThrow()
  })
})

describe('TokenService — key rotation overlap', () => {
  it('verifies a token signed by the PREVIOUS key, and signs new tokens with the new kid', async () => {
    const oldKey = await makeKeypair('ek-ed25519-1')
    const newKey = await makeKeypair('ek-ed25519-2')

    // A token minted before rotation (by the old key).
    const before = await makeService(oldKey)
    const { token: oldToken } = await before.signAccess(CLAIMS)

    // After rotation: sign with newKey, keep oldKey verify-only.
    const after = await makeService(newKey, oldKey)

    // Old token still validates (verify-only overlap).
    const oldPayload = await after.verifyAccess(oldToken)
    expect(oldPayload.sub).toBe(CLAIMS.userId)

    // New tokens carry the new kid and verify.
    const { token: newToken } = await after.signAccess(CLAIMS)
    const newPayload = await after.verifyAccess(newToken)
    expect(newPayload.sub).toBe(CLAIMS.userId)

    // JWKS publishes BOTH public keys for the overlap.
    const kids = after.getJwks().keys.map((k) => k.kid).sort()
    expect(kids).toEqual(['ek-ed25519-1', 'ek-ed25519-2'])
    expect(after.isOwnKid('ek-ed25519-1')).toBe(true)
    expect(after.isOwnKid('ek-ed25519-2')).toBe(true)
  })
})
