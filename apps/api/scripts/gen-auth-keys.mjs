// Usage: node scripts/gen-auth-keys.mjs
// Prints AUTH_JWT_PRIVATE_KEY (PKCS8) + AUTH_JWT_PUBLIC_KEY (SPKI) + AUTH_OTP_PEPPER,
// single-line (\n-escaped) for appending to a gitignored .env. Run once.
import { generateKeyPair, exportPKCS8, exportSPKI } from 'jose'

const { privateKey, publicKey } = await generateKeyPair('EdDSA', { extractable: true })
const privPem = await exportPKCS8(privateKey)
const pubPem = await exportSPKI(publicKey)

const esc = (s) => s.trimEnd().replace(/\n/g, '\\n')
console.log(`AUTH_JWT_PRIVATE_KEY="${esc(privPem)}"`)
console.log(`AUTH_JWT_PUBLIC_KEY="${esc(pubPem)}"`)
console.log(`AUTH_OTP_PEPPER="${Buffer.from(crypto.getRandomValues(new Uint8Array(32))).toString('base64url')}"`)
