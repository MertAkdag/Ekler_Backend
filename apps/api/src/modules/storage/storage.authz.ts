import { randomUUID } from 'node:crypto'

/**
 * Pure authorization + key helpers for the storage module. No DB / S3 here so the
 * security-critical bits (LIKE escaping, owner partitioning, forced keys) are unit
 * testable in isolation.
 */

/** Strip a path/URL down to a bare object key; reject empty or traversal. */
export function normalizePath(value: unknown): string | null {
  if (typeof value !== 'string') return null
  const normalized = value.trim().replace(/^\/+/, '')
  if (!normalized || normalized.includes('..')) return null
  return normalized
}

/**
 * Escape LIKE metacharacters (`\ % _`) so an attacker-supplied path can't act as a
 * wildcard inside a LIKE pattern. The original edge fn interpolated the raw
 * path into `ilike %${p}`, so a path containing `%`/`_` could broaden the match and
 * authorize someone else's image (IDOR). Use with `ESCAPE '\'`.
 */
export function escapeLike(s: string): string {
  return s.replace(/([\\%_])/g, '\\$1')
}

/** Split into the viewer's own paths (prefix `userId/`) and the rest needing a DB check. */
export function partitionByOwner(
  userId: string,
  paths: string[],
): { own: string[]; toCheck: string[] } {
  const prefix = `${userId}/`
  const own: string[] = []
  const toCheck: string[] = []
  for (const p of paths) (p.startsWith(prefix) ? own : toCheck).push(p)
  return { own, toCheck }
}

/**
 * Of `toCheck`, which paths are backed by a row whose stored url (returned from a
 * domain-scoped query) equals the path or ends with it (image_url can hold a bare
 * path or a full URL ending in the path).
 */
export function matchByUrl(toCheck: string[], urls: string[]): string[] {
  return toCheck.filter((p) => urls.some((u) => u === p || u.endsWith(p)))
}

const EXT_BY_CONTENT_TYPE: Record<string, string> = {
  'image/jpeg': 'jpg',
  'image/jpg': 'jpg',
  'image/png': 'png',
  'image/webp': 'webp',
  'image/heic': 'heic',
  'image/heif': 'heif',
  'application/pdf': 'pdf',
}

export const IMAGE_CONTENT_TYPES = new Set([
  'image/jpeg',
  'image/jpg',
  'image/png',
  'image/webp',
  'image/heic',
  'image/heif',
])
export const NOTE_CONTENT_TYPES = new Set([...IMAGE_CONTENT_TYPES, 'application/pdf'])

export function extForContentType(contentType: string): string | null {
  return EXT_BY_CONTENT_TYPE[contentType.toLowerCase()] ?? null
}

/**
 * Server-forced object key `{userId}/{uuid}.{ext}`. The `{userId}/` prefix is what the
 * read guard trusts for "owner", so the client must NEVER choose it. Returns null for
 * a content-type with no known extension.
 */
export function buildObjectKey(userId: string, contentType: string): string | null {
  const ext = extForContentType(contentType)
  if (!ext) return null
  return `${userId}/${randomUUID()}.${ext}`
}
