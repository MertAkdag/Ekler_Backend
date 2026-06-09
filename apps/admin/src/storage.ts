/**
 * Server-side image signing for the admin show screens.
 *
 * Private-bucket image/file columns (confessions.image_url, notes.file_url) store a
 * storage PATH — the browser can't load it. The show action's `after` hook runs in
 * the admin Node process (has the service-role key) and swaps those paths for short-
 * lived signed URLs so the sectioned show can render them. Public-bucket values
 * (already full http URLs, e.g. communities avatars) are left untouched.
 */

interface SignedField {
  field: string
  bucket: string
}

/** Private-bucket image/file columns per resource that need signing. */
const SIGNED_FIELDS: Record<string, SignedField[]> = {
  confessions: [{ field: 'image_url', bucket: 'confessions' }],
  notes: [{ field: 'file_url', bucket: 'notes' }],
  community_posts: [{ field: 'image_url', bucket: 'communities' }],
}

/** Normalize a stored value to a storage path, or null when it's an external/public URL to leave as-is. */
function toStoragePath(value: string, bucket: string): string | null {
  if (!/^https?:\/\//i.test(value)) return value.replace(/^\/+/, '') // already a path
  const m = value.match(
    new RegExp(`/storage/v1/(?:object|render/image)/(?:sign|public|authenticated)/${bucket}/(.+?)(?:\\?|$)`),
  )
  return m && m[1] ? decodeURIComponent(m[1]) : null
}

/** Create a 1h signed URL via the Supabase Storage REST API (service-role key). */
async function signUrl(bucket: string, path: string): Promise<string | null> {
  const base = process.env.SUPABASE_URL
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY
  if (!base || !key) return null
  const encoded = path.split('/').map(encodeURIComponent).join('/')
  try {
    const res = await fetch(`${base}/storage/v1/object/sign/${bucket}/${encoded}`, {
      method: 'POST',
      headers: { Authorization: `Bearer ${key}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({ expiresIn: 3600 }),
    })
    if (!res.ok) return null
    const json = (await res.json()) as { signedURL?: string; signedUrl?: string }
    const rel = json.signedURL ?? json.signedUrl
    if (!rel) return null
    return `${base}/storage/v1${rel.startsWith('/') ? rel : `/${rel}`}`
  } catch {
    return null
  }
}

async function signRecordImages(resourceId: string, params?: Record<string, unknown>): Promise<void> {
  const fields = SIGNED_FIELDS[resourceId]
  if (!params || !fields) return
  for (const { field, bucket } of fields) {
    const v = params[field]
    if (typeof v !== 'string' || v === '') continue
    const path = toStoragePath(v, bucket)
    if (!path) continue // external / public URL → leave as-is
    const signed = await signUrl(bucket, path)
    if (signed) params[field] = signed
  }
}

interface ShowResponse {
  record?: { params?: Record<string, unknown> }
}

/** AdminJS show-action `after` hook: sign the record's private image fields server-side. */
export function signImagesAfter(resourceId: string) {
  return async (response: ShowResponse): Promise<ShowResponse> => {
    await signRecordImages(resourceId, response.record?.params)
    return response
  }
}
