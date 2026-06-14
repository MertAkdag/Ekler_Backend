import { Inject, Injectable, type OnModuleInit } from '@nestjs/common'
import { S3Client, GetObjectCommand, PutObjectCommand, DeleteObjectCommand } from '@aws-sdk/client-s3'
import { getSignedUrl } from '@aws-sdk/s3-request-presigner'
import type { StorageBucket } from '@ekler/contracts'
import { ENV, type Env } from '../../config/env'
import { AppError } from '../../core/errors/app-error'

/** Presigned PUT URLs are short-lived — only needed for the immediate upload. */
const UPLOAD_URL_TTL = 300

/**
 * Object storage over the S3 API. Provider-neutral: the same code drives self-hosted
 * MinIO (our VPS), Cloudflare R2, or AWS S3 — only env (endpoint/keys/bucket) differs.
 * Disabled until STORAGE_ENDPOINT + keys are present (so the app boots pre-P4).
 */
@Injectable()
export class StorageService implements OnModuleInit {
  private client: S3Client | null = null

  constructor(@Inject(ENV) private readonly env: Env) {}

  onModuleInit(): void {
    const ep = this.env.STORAGE_ENDPOINT
    const ak = this.env.STORAGE_ACCESS_KEY_ID
    const sk = this.env.STORAGE_SECRET_ACCESS_KEY
    if (!ep || !ak || !sk) return // not configured yet → storage routes 503
    this.client = new S3Client({
      endpoint: ep,
      region: this.env.STORAGE_REGION,
      forcePathStyle: this.env.STORAGE_FORCE_PATH_STYLE, // MinIO needs path-style
      credentials: { accessKeyId: ak, secretAccessKey: sk },
    })
  }

  get enabled(): boolean {
    return this.client !== null
  }

  private requireClient(): S3Client {
    if (!this.client) throw new AppError('INTERNAL', 'Object storage is not configured.')
    return this.client
  }

  /** Resolve a logical bucket name to its configured physical bucket. */
  bucketName(bucket: StorageBucket): string {
    switch (bucket) {
      case 'confessions':
        return this.env.STORAGE_BUCKET_CONFESSIONS
      case 'notes':
        return this.env.STORAGE_BUCKET_NOTES
      case 'communities':
        return this.env.STORAGE_BUCKET_COMMUNITIES
    }
  }

  /** Presigned GET URL for a private object. */
  async signedReadUrl(
    bucket: StorageBucket,
    key: string,
    expiresIn: number = this.env.STORAGE_SIGN_TTL,
  ): Promise<{ signedUrl: string; expiresAt: string }> {
    const ttl = Math.min(Math.max(Math.floor(expiresIn), 1), 24 * 60 * 60)
    const cmd = new GetObjectCommand({ Bucket: this.bucketName(bucket), Key: key })
    const signedUrl = await getSignedUrl(this.requireClient(), cmd, { expiresIn: ttl })
    return { signedUrl, expiresAt: new Date(Date.now() + ttl * 1000).toISOString() }
  }

  /**
   * Presigned PUT URL. ContentType + ContentLength are pinned into the signature, so
   * the client must send exactly those — that's how we enforce mime + max size on a
   * PUT (presigned PUT has no Content-Length-Range; an exact length is the lever).
   */
  async signedUploadUrl(
    bucket: StorageBucket,
    key: string,
    contentType: string,
    contentLength: number,
  ): Promise<{ url: string; key: string; expiresAt: string }> {
    const cmd = new PutObjectCommand({
      Bucket: this.bucketName(bucket),
      Key: key,
      ContentType: contentType,
      ContentLength: contentLength,
    })
    const url = await getSignedUrl(this.requireClient(), cmd, {
      expiresIn: UPLOAD_URL_TTL,
      signableHeaders: new Set(['content-type', 'content-length']),
    })
    return { url, key, expiresAt: new Date(Date.now() + UPLOAD_URL_TTL * 1000).toISOString() }
  }

  /**
   * Delete an object. Used for content cleanup (e.g. a deleted confession's image).
   * Callers treat this as best-effort — a failed cleanup must not fail the DB delete.
   */
  async deleteObject(bucket: StorageBucket, key: string): Promise<void> {
    const cmd = new DeleteObjectCommand({ Bucket: this.bucketName(bucket), Key: key })
    await this.requireClient().send(cmd)
  }
}
