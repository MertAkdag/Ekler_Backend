import { Pool } from 'pg'

const DATABASE_URL = process.env.DATABASE_URL
if (!DATABASE_URL) throw new Error('DATABASE_URL is required (see apps/admin/.env)')

/**
 * Small dedicated pool for moderation action handlers (parameterized writes).
 * Separate from the @adminjs/sql knex pools so action SQL is explicit and we can
 * run the multi-statement ban transaction. Uses the same DATABASE_URL (the txn
 * pooler), which supports transactions.
 */
export const pool = new Pool({
  connectionString: DATABASE_URL,
  max: 3,
  application_name: 'ekler-admin-actions',
})
