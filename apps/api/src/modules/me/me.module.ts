import { Module } from '@nestjs/common'
import { StorageModule } from '../storage/storage.module'
import { MeController } from './me.controller'
import { MeService } from './me.service'

@Module({
  imports: [StorageModule],
  controllers: [MeController],
  providers: [MeService],
})
export class MeModule {}
