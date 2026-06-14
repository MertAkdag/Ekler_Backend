import { Module } from '@nestjs/common'
import { StorageModule } from '../storage/storage.module'
import { NotesController } from './notes.controller'
import { NotesService } from './notes.service'

@Module({
  imports: [StorageModule],
  controllers: [NotesController],
  providers: [NotesService],
})
export class NotesModule {}
