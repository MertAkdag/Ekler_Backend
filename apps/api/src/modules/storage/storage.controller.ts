import { Body, Controller, Inject, Post } from '@nestjs/common'
import { sql } from 'drizzle-orm'
import type { SignPathsResponse, UploadUrlResponse, StorageBucket } from '@ekler/contracts'
import { CurrentUser } from '../../core/auth/public.decorator'
import type { AuthPrincipal } from '../../core/cls/cls-store'
import { AppError } from '../../core/errors/app-error'
import { DRIZZLE, type Db } from '../../db/drizzle.module'
import { ENV, type Env } from '../../config/env'
import { StorageService } from './storage.service'
import { SignPathsDto, UploadUrlDto } from './storage.dto'
import {
  IMAGE_CONTENT_TYPES,
  NOTE_CONTENT_TYPES,
  buildObjectKey,
  escapeLike,
  matchByUrl,
  normalizePath,
  partitionByOwner,
} from './storage.authz'

/** Private buckets whose reads are gated by ownership/tenancy. */
type GuardedBucket = Extract<StorageBucket, 'confessions' | 'notes' | 'communities'>

@Controller('storage')
export class StorageController {
  constructor(
    @Inject(DRIZZLE) private readonly db: Db,
    @Inject(ENV) private readonly env: Env,
    private readonly storage: StorageService,
  ) {}

  /** Batch-sign confession images (private bucket). Mirrors the legacy edge fn shape. */
  @Post('signed-image')
  async signImages(
    @CurrentUser() user: AuthPrincipal,
    @Body() body: SignPathsDto,
  ): Promise<SignPathsResponse> {
    return this.signBatch(user, body, 'confessions')
  }

  /** Batch-sign note files (private bucket), tenancy-guarded the same way. */
  @Post('signed-note')
  async signNotes(
    @CurrentUser() user: AuthPrincipal,
    @Body() body: SignPathsDto,
  ): Promise<SignPathsResponse> {
    return this.signBatch(user, body, 'notes')
  }

  /** Batch-sign community avatars (private bucket), tenancy-guarded the same way. */
  @Post('signed-community')
  async signCommunity(
    @CurrentUser() user: AuthPrincipal,
    @Body() body: SignPathsDto,
  ): Promise<SignPathsResponse> {
    return this.signBatch(user, body, 'communities')
  }

  /**
   * Presigned PUT URL for a new upload. The object key is server-forced to
   * `{userId}/...` (the prefix the read guard trusts), and content-type + exact
   * length are pinned into the signature.
   */
  @Post('upload-url')
  async uploadUrl(
    @CurrentUser() user: AuthPrincipal,
    @Body() body: UploadUrlDto,
  ): Promise<UploadUrlResponse> {
    this.assertEnabled()
    const contentType = body.contentType.toLowerCase()
    const allowed = body.bucket === 'notes' ? NOTE_CONTENT_TYPES : IMAGE_CONTENT_TYPES
    if (!allowed.has(contentType)) {
      throw new AppError('VALIDATION_FAILED', 'Desteklenmeyen dosya türü.')
    }
    if (body.contentLength > this.env.STORAGE_UPLOAD_MAX_BYTES) {
      throw new AppError('VALIDATION_FAILED', 'Dosya boyutu çok büyük.')
    }
    const key = buildObjectKey(user.userId, contentType)
    if (!key) throw new AppError('VALIDATION_FAILED', 'Desteklenmeyen dosya türü.')
    return this.storage.signedUploadUrl(body.bucket, key, contentType, body.contentLength)
  }

  // ── internals ──────────────────────────────────────────────────────────────

  private assertEnabled(): void {
    if (!this.storage.enabled) throw new AppError('INTERNAL', 'Object storage is not configured.')
  }

  private async signBatch(
    user: AuthPrincipal,
    body: SignPathsDto,
    bucket: GuardedBucket,
  ): Promise<SignPathsResponse> {
    this.assertEnabled()
    const paths = Array.from(
      new Set(body.paths.map(normalizePath).filter((p): p is string => p !== null)),
    )
    if (paths.length === 0) throw new AppError('VALIDATION_FAILED', 'Geçerli path bulunamadı.')

    const authorized = await this.authorize(user, paths, bucket)
    const items: SignPathsResponse['items'] = []
    const failed: SignPathsResponse['failed'] = []
    for (const path of paths) {
      if (!authorized.has(path)) {
        failed.push({ path, error: 'unauthorized_path' })
        continue
      }
      try {
        const { signedUrl, expiresAt } = await this.storage.signedReadUrl(
          bucket,
          path,
          body.expiresIn,
        )
        items.push({ path, signedUrl, expiresAt })
      } catch {
        failed.push({ path, error: 'sign_failed' })
      }
    }
    return { items, failed }
  }

  /**
   * Two-tier authorization (Y-3): a viewer may sign a path if (1) they own it
   * (`{userId}/` prefix), or (2) it is referenced by a row in THEIR university.
   * The DB check is a single batched, domain-scoped query with LIKE metacharacters
   * escaped — no per-path N+1 and no wildcard-injection (the edge fn had both).
   */
  private async authorize(
    user: AuthPrincipal,
    paths: string[],
    bucket: GuardedBucket,
  ): Promise<Set<string>> {
    const { own, toCheck } = partitionByOwner(user.userId, paths)
    const authorized = new Set(own)
    const viewerDomain = user.universityDomain
    if (toCheck.length === 0 || !viewerDomain) return authorized

    // Each guarded bucket is backed by a domain-scoped table column holding the
    // object path: confessions.image_url, notes.file_url, communities.avatar_url.
    const col =
      bucket === 'confessions' ? sql`image_url` : bucket === 'notes' ? sql`file_url` : sql`avatar_url`
    const tbl =
      bucket === 'confessions'
        ? sql`public.confessions`
        : bucket === 'notes'
          ? sql`public.notes`
          : sql`public.communities`
    const patterns = toCheck.map((p) => `%${escapeLike(p)}`)
    const res = (await this.db.execute(sql`
      select ${col} as url
      from ${tbl}
      where university_domain = ${viewerDomain}
        and ( ${col} = any(${toCheck}) or ${col} like any(${patterns}) escape '\\' )
    `)) as unknown as { rows: Array<{ url: string | null }> }

    const urls = res.rows.map((r) => r.url).filter((u): u is string => u !== null)
    for (const p of matchByUrl(toCheck, urls)) authorized.add(p)
    return authorized
  }
}
