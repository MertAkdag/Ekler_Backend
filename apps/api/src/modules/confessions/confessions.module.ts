import { Module } from '@nestjs/common'
import { StorageModule } from '../storage/storage.module'
import { ConfessionsController } from './confessions.controller'
import { ConfessionsService } from './confessions.service'

@Module({
  imports: [StorageModule],
  controllers: [ConfessionsController],
  providers: [ConfessionsService],
})
export class ConfessionsModule {}
