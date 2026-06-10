import { describe, it, expect } from 'vitest'
import {
  buildObjectKey,
  escapeLike,
  extForContentType,
  matchByUrl,
  normalizePath,
  partitionByOwner,
} from './storage.authz'

describe('escapeLike — LIKE-injection defense', () => {
  it('escapes %, _ and backslash', () => {
    expect(escapeLike('a%b')).toBe('a\\%b')
    expect(escapeLike('a_b')).toBe('a\\_b')
    expect(escapeLike('a\\b')).toBe('a\\\\b')
  })
  it('leaves a normal path untouched', () => {
    expect(escapeLike('uid/abc-123.jpg')).toBe('uid/abc-123.jpg')
  })
})

describe('partitionByOwner', () => {
  it('routes own-prefixed paths to `own`, rest to `toCheck`', () => {
    const { own, toCheck } = partitionByOwner('u1', ['u1/a.jpg', 'u2/b.jpg', 'u1/c.png'])
    expect(own).toEqual(['u1/a.jpg', 'u1/c.png'])
    expect(toCheck).toEqual(['u2/b.jpg'])
  })
  it('requires the exact `userId/` prefix (no partial-id spoofing)', () => {
    // a path under "u10/" must NOT count as owned by "u1"
    const { own, toCheck } = partitionByOwner('u1', ['u10/x.jpg'])
    expect(own).toEqual([])
    expect(toCheck).toEqual(['u10/x.jpg'])
  })
})

describe('matchByUrl — authorize only exact/suffix matches', () => {
  it('authorizes an exact or suffix (full-URL) match', () => {
    const urls = ['https://cdn/x/u2/b.jpg', 'u2/c.png']
    expect(matchByUrl(['u2/b.jpg', 'u2/c.png'], urls)).toEqual(['u2/b.jpg', 'u2/c.png'])
  })
  it('does NOT treat `_` as a wildcard (the old ilike bug)', () => {
    // 'victim0secret' would match LIKE '%victim_secret'; endsWith must not.
    expect(matchByUrl(['u2/victim_secret.jpg'], ['u2/victim0secret.jpg'])).toEqual([])
  })
  it('rejects a path with no backing row', () => {
    expect(matchByUrl(['u2/orphan.jpg'], ['u2/other.jpg'])).toEqual([])
  })
})

describe('normalizePath', () => {
  it('strips leading slashes', () => {
    expect(normalizePath('/u1/a.jpg')).toBe('u1/a.jpg')
  })
  it('rejects traversal and empties', () => {
    expect(normalizePath('../secret')).toBeNull()
    expect(normalizePath('  ')).toBeNull()
    expect(normalizePath(123)).toBeNull()
  })
})

describe('buildObjectKey — server-forced key', () => {
  it('always prefixes the owner id and uses the content-type extension', () => {
    const key = buildObjectKey('u1', 'image/jpeg')
    expect(key).toMatch(/^u1\/[0-9a-f-]{36}\.jpg$/)
  })
  it('maps known content types and rejects unknown', () => {
    expect(extForContentType('application/pdf')).toBe('pdf')
    expect(extForContentType('image/webp')).toBe('webp')
    expect(extForContentType('text/html')).toBeNull()
    expect(buildObjectKey('u1', 'text/html')).toBeNull()
  })
})
