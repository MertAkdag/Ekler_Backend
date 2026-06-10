import { Module } from '@nestjs/common'
import { StorageController } from './storage.controller'
import { StorageService } from './storage.service'

/** Object storage (P4) — presigned read/upload over the S3 API (MinIO/R2/S3). */
@Module({
  controllers: [StorageController],
  providers: [StorageService],
  exports: [StorageService],
})
export class StorageModule {}
