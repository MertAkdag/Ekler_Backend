import type { PgTableWithColumns } from 'drizzle-orm/pg-core'

/**
 * Brand marking a Drizzle table as university-scoped. Only the launch-mandatory
 * scoped tables (and per-domain additions) are allowed to satisfy `ScopedTable`,
 * and they may ONLY be reached through `ScopedRepository`. A lint rule (added in
 * P2) forbids passing a branded table to the raw `db`.
 *
 * A scoped table MUST expose a `universityDomain` column.
 */
declare const scopedBrand: unique symbol

export type ScopedTable = PgTableWithColumns<any> & {
  readonly [scopedBrand]?: true
}

/**
 * The 11 launch-mandatory scoped tables (plan §Cross-Cutting #1). Filled in as
 * each table is introspected. `community_posts/events`, `reports`,
 * `course_suggestions` join this set as their domains port.
 */
export const SCOPED_TABLE_NAMES = [
  'confessions',
  'confession_comments',
  'confession_likes',
  'confession_bookmarks',
  'notes',
  'note_votes',
  'note_comments',
  'study_sessions',
  'session_participants',
  'communities',
  'community_members',
] as const

export type ScopedTableName = (typeof SCOPED_TABLE_NAMES)[number]
