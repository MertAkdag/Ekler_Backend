import { Global, Module, type OnApplicationShutdown, Inject } from '@nestjs/common'
import { drizzle, type NodePgDatabase } from 'drizzle-orm/node-postgres'
import { Pool } from 'pg'
import { ENV, type Env } from '../config/env'
import * as schema from './schema'

export const DRIZZLE = Symbol('DRIZZLE')
export const PG_POOL = Symbol('PG_POOL')

/** Fully-typed Drizzle DB (introspected schema + relations). */
export type Db = NodePgDatabase<typeof schema>

@Global()
@Module({
  providers: [
    {
      provide: PG_POOL,
      inject: [ENV],
      useFactory: (env: Env) =>
        new Pool({
          connectionString: env.DATABASE_URL,
          max: env.PG_POOL_MAX,
          // Supavisor SESSION-mode pooler is assumed (port 5432). Keep a single
          // app-wide pool; never request-scoped.
          application_name: 'ekler-api',
        }),
    },
    {
      provide: DRIZZLE,
      inject: [PG_POOL],
      useFactory: (pool: Pool): Db => drizzle({ client: pool, schema, casing: 'snake_case' }),
    },
  ],
  exports: [DRIZZLE, PG_POOL],
})
export class DrizzleModule implements OnApplicationShutdown {
  constructor(@Inject(PG_POOL) private readonly pool: Pool) {}

  async onApplicationShutdown(): Promise<void> {
    await this.pool.end()
  }
}
