import { cursorPayloadSchema, type CursorPayload } from '@ekler/contracts'

/**
 * Opaque keyset-cursor codec (server-side). Clients treat the cursor as a black
 * box; only the API encodes/decodes it. base64url of `{ created_at, id }`.
 */
export function encodeCursor(payload: CursorPayload): string {
  return Buffer.from(JSON.stringify(payload), 'utf8').toString('base64url')
}

export function decodeCursor(raw: string): CursorPayload | null {
  try {
    const json = Buffer.from(raw, 'base64url').toString('utf8')
    return cursorPayloadSchema.parse(JSON.parse(json))
  } catch {
    return null
  }
}
