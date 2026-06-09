import { Module } from '@nestjs/common'
import { CoreModule } from './core/core.module'
import { HealthModule } from './modules/health/health.module'
import { MeModule } from './modules/me/me.module'
import { CatalogModule } from './modules/catalog/catalog.module'
import { ConfessionsModule } from './modules/confessions/confessions.module'
import { NotesModule } from './modules/notes/notes.module'
import { SessionsModule } from './modules/sessions/sessions.module'
import { EventsModule } from './modules/events/events.module'
import { CommunitiesModule } from './modules/communities/communities.module'
import { ReportsModule } from './modules/reports/reports.module'

/**
 * Root module. CoreModule is the cross-cutting backbone (guards, pipe,
 * interceptors, filter, DB, scope). Domain modules are added per migration phase:
 *   P1: MeModule, CatalogModule (universities/faculties/departments/courses)
 *   P2: ConfessionsModule, NotesModule, SessionsModule, EventsModule, CommunitiesModule
 *   P3: ModerationModule, ReportsModule  ...
 */
@Module({
  imports: [
    CoreModule,
    HealthModule,
    MeModule,
    CatalogModule,
    ConfessionsModule,
    NotesModule,
    SessionsModule,
    EventsModule,
    CommunitiesModule,
    ReportsModule,
  ],
})
export class AppModule {}
