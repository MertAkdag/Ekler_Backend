import type { PropertyOptions, ResourceWithOptions } from 'adminjs'
import type { ResourceMetadata } from '@adminjs/sql'

/**
 * Per-resource AdminJS options (the v1 panel registered raw tables with every
 * column visible and no grouping). Here each table gets:
 *  - a navigation group (sidebar sections instead of one flat list),
 *  - a curated `listProperties` set (no more 25-column horizontal scroll),
 *  - a sensible default sort,
 *  - secrets/noise hidden and trigger-maintained counters made read-only.
 */

type Dir = 'asc' | 'desc'

interface Cfg {
  table: string
  nav: string
  list: string[]
  sort?: { sortBy: string; direction: Dir }
  schema?: 'auth'
}

/**
 * Hidden in every action wherever the column exists — secrets and dead weight.
 * Safe to over-apply: a hidden property never renders, so naming a column that a
 * given table lacks is a no-op.
 */
const HIDE = new Set([
  'normalized_body',
  'moderation_source',
  'instance_id',
  'raw_app_meta_data',
  'raw_user_meta_data',
  'encrypted_password',
  'password_hash',
  'confirmation_token',
  'recovery_token',
  'email_change_token_new',
  'email_change_token_current',
  'phone_change_token',
  'reauthentication_token',
])

/** Shown but not editable — trigger-maintained counters and system timestamps. */
const READONLY = new Set([
  'created_at',
  'updated_at',
  'last_active',
  'last_login_at',
  'last_sign_in_at',
  'last_moderated_at',
  'like_count',
  'comment_count',
  'member_count',
  'follower_count',
  'participant_count',
  'download_count',
  'vote_score',
  'violation_count',
  'report_count',
  'xp_points',
])

const RESOURCES: Cfg[] = [
  // ── Moderasyon ──
  {
    table: 'reports',
    nav: 'Moderasyon',
    sort: { sortBy: 'created_at', direction: 'desc' },
    list: ['target_type', 'reason', 'status', 'reporter_id', 'created_at'],
  },
  {
    table: 'user_sanctions',
    nav: 'Moderasyon',
    sort: { sortBy: 'created_at', direction: 'desc' },
    list: ['user_id', 'sanction_type', 'is_active', 'expires_at', 'created_at'],
  },
  // ── İçerik ──
  {
    table: 'confessions',
    nav: 'İçerik',
    sort: { sortBy: 'created_at', direction: 'desc' },
    list: ['body', 'category', 'author_id', 'moderation_status', 'is_flagged', 'report_count', 'created_at'],
  },
  {
    table: 'confession_comments',
    nav: 'İçerik',
    sort: { sortBy: 'created_at', direction: 'desc' },
    list: ['body', 'author_id', 'confession_id', 'moderation_status', 'is_flagged', 'created_at'],
  },
  {
    table: 'notes',
    nav: 'İçerik',
    sort: { sortBy: 'created_at', direction: 'desc' },
    list: ['title', 'course_id', 'author_id', 'vote_score', 'is_hidden', 'is_flagged', 'created_at'],
  },
  {
    table: 'communities',
    nav: 'İçerik',
    sort: { sortBy: 'created_at', direction: 'desc' },
    list: ['name', 'category', 'member_count', 'is_active', 'is_verified', 'created_at'],
  },
  {
    table: 'community_posts',
    nav: 'İçerik',
    sort: { sortBy: 'created_at', direction: 'desc' },
    list: ['body', 'community_id', 'author_id', 'is_pinned', 'created_at'],
  },
  {
    table: 'study_sessions',
    nav: 'İçerik',
    sort: { sortBy: 'starts_at', direction: 'desc' },
    list: ['title', 'course_id', 'creator_id', 'status', 'starts_at', 'participant_count'],
  },
  // ── Etkinlikler ──
  {
    table: 'city_events',
    nav: 'Etkinlikler',
    sort: { sortBy: 'starts_at', direction: 'desc' },
    list: ['title', 'city_id', 'category', 'starts_at', 'status', 'is_sponsored'],
  },
  {
    table: 'event_submissions',
    nav: 'Etkinlikler',
    sort: { sortBy: 'created_at', direction: 'desc' },
    list: ['title', 'partner_name', 'contact_email', 'status', 'created_at'],
  },
  {
    table: 'event_partners',
    nav: 'Etkinlikler',
    sort: { sortBy: 'name', direction: 'asc' },
    list: ['name', 'partner_kind', 'contact_email', 'created_at'],
  },
  // ── Kullanıcılar ──
  {
    table: 'profiles',
    nav: 'Kullanıcılar',
    sort: { sortBy: 'created_at', direction: 'desc' },
    list: ['username', 'full_name', 'university_name', 'is_admin', 'is_banned', 'is_restricted', 'created_at'],
  },
  {
    table: 'notifications',
    nav: 'Kullanıcılar',
    sort: { sortBy: 'created_at', direction: 'desc' },
    list: ['recipient_id', 'type', 'title', 'is_read', 'created_at'],
  },
  // ── Katalog ──
  {
    table: 'courses',
    nav: 'Katalog',
    sort: { sortBy: 'code', direction: 'asc' },
    list: ['code', 'name', 'faculty', 'university_domain', 'credits'],
  },
  {
    table: 'faculties',
    nav: 'Katalog',
    sort: { sortBy: 'name', direction: 'asc' },
    list: ['name'],
  },
  {
    table: 'departments',
    nav: 'Katalog',
    sort: { sortBy: 'name', direction: 'asc' },
    list: ['name', 'faculty_id', 'duration_years'],
  },
  {
    table: 'cities',
    nav: 'Katalog',
    sort: { sortBy: 'name', direction: 'asc' },
    list: ['name'],
  },
  // ── Sistem ──
  {
    table: 'admin_identities',
    nav: 'Sistem',
    sort: { sortBy: 'created_at', direction: 'desc' },
    list: ['email', 'display_name', 'status', 'is_super_admin', 'last_login_at'],
  },
]

/** auth.users lives in the `auth` schema → separate adapter, its own config. */
const AUTH_USERS: Cfg = {
  table: 'users',
  nav: 'Kullanıcılar',
  schema: 'auth',
  sort: { sortBy: 'created_at', direction: 'desc' },
  list: ['email', 'phone', 'email_confirmed_at', 'last_sign_in_at', 'banned_until', 'created_at'],
}

interface SqlDatabase {
  table(name: string): ResourceMetadata
}

/** Apply the HIDE / READONLY policy to whichever of a resource's real columns match. */
function buildProperties(resource: ResourceMetadata): Record<string, PropertyOptions> {
  const props: Record<string, PropertyOptions> = {}
  for (const path of resource.properties.map((p) => p.path())) {
    if (HIDE.has(path)) {
      props[path] = { isVisible: false }
    } else if (READONLY.has(path)) {
      props[path] = {
        isDisabled: true,
        isVisible: { list: true, show: true, edit: false, filter: true },
      }
    }
  }
  return props
}

export function buildResources(publicDb: SqlDatabase, authDb: SqlDatabase): ResourceWithOptions[] {
  return [...RESOURCES, AUTH_USERS].map((cfg) => {
    const db = cfg.schema === 'auth' ? authDb : publicDb
    const resource = db.table(cfg.table)
    return {
      resource,
      options: {
        navigation: { name: cfg.nav },
        sort: cfg.sort,
        listProperties: cfg.list,
        properties: buildProperties(resource),
      },
    }
  })
}
