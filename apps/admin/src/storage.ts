/**
 * Server-side image signing for the admin show screens.
 *
 * Private-bucket image/file columns (confessions.image_url, notes.file_url) store a
 * storage PATH — the browser can't load it. The show action's `after` hook runs in
 * the admin Node process (has the service-role key) and swaps those paths for short-
 * lived signed URLs so the sectioned show can render them. Public-bucket values
 * (already full http URLs, e.g. communities avatars) are left untouched.
 *
 * Storage is MinIO (S3): URLs are presigned against the public STORAGE_ENDPOINT
 * the API uses. The admin process shares the same STORAGE_* env.
 */
import { S3Client, GetObjectCommand } from '@aws-sdk/client-s3'
import { getSignedUrl } from '@aws-sdk/s3-request-presigner'

const SIGNED_URL_TTL = 3600

const BUCKET_NAMES: Record<string, string | undefined> = {
  confessions: process.env.STORAGE_BUCKET_CONFESSIONS,
  notes: process.env.STORAGE_BUCKET_NOTES,
  communities: process.env.STORAGE_BUCKET_COMMUNITIES,
}

let s3Client: S3Client | null = null
function getS3(): S3Client | null {
  if (s3Client) return s3Client
  const endpoint = process.env.STORAGE_ENDPOINT
  const accessKeyId = process.env.STORAGE_ACCESS_KEY_ID
  const secretAccessKey = process.env.STORAGE_SECRET_ACCESS_KEY
  if (!endpoint || !accessKeyId || !secretAccessKey) return null
  s3Client = new S3Client({
    region: process.env.STORAGE_REGION || 'auto',
    endpoint,
    forcePathStyle: process.env.STORAGE_FORCE_PATH_STYLE === 'true',
    credentials: { accessKeyId, secretAccessKey },
  })
  return s3Client
}

interface SignedField {
  field: string
  bucket: string
  /** 'always' = run the image transform (web-format output, decodes HEIC); 'image-only'
   *  = transform only when the row is an image (notes can be a PDF → keep original). */
  transform: 'always' | 'image-only'
}

/** Private-bucket image/file columns per resource that need signing. */
const SIGNED_FIELDS: Record<string, SignedField[]> = {
  confessions: [{ field: 'image_url', bucket: 'confessions', transform: 'always' }],
  notes: [{ field: 'file_url', bucket: 'notes', transform: 'image-only' }],
  community_posts: [{ field: 'image_url', bucket: 'communities', transform: 'always' }],
}

/** Normalize a stored value to a storage path, or null when it's an external/public URL to leave as-is. */
function toStoragePath(value: string): string | null {
  if (!/^https?:\/\//i.test(value)) return value.replace(/^\/+/, '') // already a path
  return null // external / public (full http) URL → leave as-is
}

/**
 * Presigned GET URL for a private MinIO object (1h), signed against the public
 * STORAGE_ENDPOINT so the admin browser can load it directly. `transform` is no
 * longer applied — RN uploads web-ready jpeg/png and MinIO has no imgproxy.
 */
async function signUrl(bucket: string, path: string, _transform: boolean): Promise<string | null> {
  const client = getS3()
  const Bucket = BUCKET_NAMES[bucket]
  if (!client || !Bucket) return null
  try {
    return await getSignedUrl(client, new GetObjectCommand({ Bucket, Key: path }), {
      expiresIn: SIGNED_URL_TTL,
    })
  } catch {
    return null
  }
}

function isImageRow(params: Record<string, unknown>): boolean {
  return String(params['file_type'] ?? '').toLowerCase().includes('image')
}

async function signRecordImages(resourceId: string, params?: Record<string, unknown>): Promise<void> {
  const fields = SIGNED_FIELDS[resourceId]
  if (!params || !fields) return
  for (const { field, bucket, transform } of fields) {
    const v = params[field]
    if (typeof v !== 'string' || v === '') continue
    const path = toStoragePath(v)
    if (!path) continue // external / public URL → leave as-is
    const doTransform = transform === 'always' || (transform === 'image-only' && isImageRow(params))
    const signed = await signUrl(bucket, path, doTransform)
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
