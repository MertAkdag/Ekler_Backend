import type { PropertyOptions, ResourceOptions, ResourceWithOptions } from 'adminjs'
import type { ResourceMetadata } from '@adminjs/sql'
import {
  communityActions,
  contentActions,
  eventSubmissionActions,
  noteActions,
  reportActions,
  userActions,
} from './actions.js'
import { Components } from './components.js'

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
  /** column → badgeMap key (a key of MAPS in status-badge.tsx) → colored badge on list + show. */
  badges?: Record<string, string>
  /** image/URL column → thumbnail on list + show; 'circle' for round avatars. */
  thumbs?: Record<string, 'rect' | 'circle'>
  /** ordered, curated SHOW properties (also the fallback body if a custom show errors). */
  show?: string[]
  /** ordered, curated EDIT+NEW properties. MUST include every NOT-NULL-without-default column. */
  edit?: string[]
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
    badges: { status: 'report_status', target_type: 'report_target' },
  },
  {
    table: 'user_sanctions',
    nav: 'Moderasyon',
    sort: { sortBy: 'created_at', direction: 'desc' },
    list: ['user_id', 'sanction_type', 'is_active', 'expires_at', 'created_at'],
    badges: { sanction_type: 'sanction_type', is_active: 'bool_active' },
  },
  // ── İçerik ──
  {
    table: 'confessions',
    nav: 'İçerik',
    sort: { sortBy: 'created_at', direction: 'desc' },
    list: ['image_url', 'body', 'category', 'author_id', 'moderation_status', 'is_flagged', 'report_count', 'created_at'],
    badges: { moderation_status: 'moderation_status', category: 'confession_category', is_flagged: 'bool_flagged' },
    thumbs: { image_url: 'rect' },
  },
  {
    table: 'confession_comments',
    nav: 'İçerik',
    sort: { sortBy: 'created_at', direction: 'desc' },
    list: ['body', 'author_id', 'confession_id', 'moderation_status', 'is_flagged', 'created_at'],
    badges: { moderation_status: 'moderation_status', is_flagged: 'bool_flagged' },
  },
  {
    table: 'notes',
    nav: 'İçerik',
    sort: { sortBy: 'created_at', direction: 'desc' },
    list: ['title', 'course_id', 'author_id', 'vote_score', 'is_hidden', 'is_flagged', 'created_at'],
    badges: { is_hidden: 'bool_hidden', is_flagged: 'bool_flagged' },
  },
  {
    table: 'communities',
    nav: 'İçerik',
    sort: { sortBy: 'created_at', direction: 'desc' },
    list: ['avatar_url', 'name', 'category', 'member_count', 'is_active', 'is_verified', 'created_at'],
    badges: { is_active: 'bool_active', is_verified: 'bool_verified' },
    thumbs: { avatar_url: 'circle', cover_url: 'rect' },
  },
  {
    table: 'community_posts',
    nav: 'İçerik',
    sort: { sortBy: 'created_at', direction: 'desc' },
    list: ['image_url', 'body', 'community_id', 'author_id', 'is_pinned', 'created_at'],
    thumbs: { image_url: 'rect' },
  },
  {
    table: 'study_sessions',
    nav: 'İçerik',
    sort: { sortBy: 'starts_at', direction: 'desc' },
    list: ['title', 'course_id', 'creator_id', 'status', 'starts_at', 'participant_count'],
    badges: { status: 'session_status' },
  },
  // ── Etkinlikler ──
  {
    table: 'city_events',
    nav: 'Etkinlikler',
    sort: { sortBy: 'starts_at', direction: 'desc' },
    list: ['cover_url', 'title', 'city_id', 'category', 'starts_at', 'status', 'is_sponsored'],
    badges: { status: 'city_event_status', is_sponsored: 'bool_sponsored' },
    thumbs: { cover_url: 'rect' },
    show: [
      'title', 'category', 'cover_url', 'description',
      'starts_at', 'ends_at', 'city_id', 'venue_name', 'venue_address',
      'organizer_name', 'organizer_instagram', 'organizer_url',
      'ticket_url', 'price_label',
      'status', 'is_sponsored', 'sponsorship_tier',
      'admin_notes',
      'partner_id', 'source_submission_id', 'created_at', 'updated_at',
    ],
    edit: [
      'title', 'category', 'cover_url', 'description',
      'starts_at', 'ends_at', 'city_id', 'venue_name', 'venue_address',
      'organizer_name', 'organizer_instagram', 'organizer_url',
      'ticket_url', 'price_label',
      'status', 'is_sponsored', 'sponsorship_tier',
      'admin_notes', 'partner_id',
    ],
  },
  {
    table: 'event_submissions',
    nav: 'Etkinlikler',
    sort: { sortBy: 'created_at', direction: 'desc' },
    list: ['cover_url', 'title', 'partner_name', 'contact_email', 'status', 'created_at'],
    badges: { status: 'submission_status' },
    thumbs: { cover_url: 'rect' },
    show: [
      'title', 'cover_url', 'description',
      'starts_at', 'ends_at', 'city_id', 'venue_name', 'venue_address',
      'partner_name', 'contact_name', 'contact_email', 'contact_phone',
      'organizer_instagram', 'organizer_url',
      'ticket_url', 'price_label', 'package_requested',
      'status', 'submission_notes', 'review_notes',
      'approved_event_id', 'created_at', 'updated_at',
    ],
    edit: [
      'title', 'cover_url', 'description',
      'starts_at', 'ends_at', 'city_id', 'venue_name', 'venue_address',
      'partner_name', 'contact_name', 'contact_email', 'contact_phone',
      'organizer_instagram', 'organizer_url',
      'ticket_url', 'price_label', 'package_requested',
      'status', 'submission_notes', 'review_notes',
    ],
  },
  {
    table: 'event_partners',
    nav: 'Etkinlikler',
    sort: { sortBy: 'name', direction: 'asc' },
    list: ['name', 'partner_kind', 'contact_email', 'created_at'],
    show: [
      'name', 'partner_kind',
      'contact_name', 'contact_email', 'contact_phone',
      'website_url', 'instagram_url',
      'notes', 'created_at', 'updated_at',
    ],
    edit: [
      'name', 'partner_kind',
      'contact_name', 'contact_email', 'contact_phone',
      'website_url', 'instagram_url',
      'notes',
    ],
  },
  // ── Kullanıcılar ──
  {
    table: 'profiles',
    nav: 'Kullanıcılar',
    sort: { sortBy: 'created_at', direction: 'desc' },
    list: ['avatar_url', 'username', 'full_name', 'university_name', 'is_admin', 'is_banned', 'is_restricted', 'created_at'],
    badges: { is_admin: 'bool_admin', is_banned: 'bool_banned', is_restricted: 'bool_restricted' },
    thumbs: { avatar_url: 'circle' },
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

/** Moderation actions per table (merged with AdminJS default actions). */
const ACTIONS_BY_TABLE: Record<string, ResourceOptions['actions']> = {
  confessions: contentActions('confessions'),
  confession_comments: contentActions('confession_comments'),
  notes: noteActions(),
  reports: reportActions(),
  communities: communityActions(),
  event_submissions: eventSubmissionActions(),
  profiles: userActions(),
}

/** Tables whose SHOW body is replaced by the sectioned RecordShow component. */
const SHOW_COMPONENT_TABLES = new Set([
  'city_events', 'event_submissions',
  'confessions', 'confession_comments', 'notes',
  'communities', 'community_posts', 'profiles',
])

/**
 * Apply HIDE / READONLY policy to a resource's real columns, then MERGE in the
 * per-column badge/thumbnail component wiring (without clobbering the policy).
 */
function buildProperties(resource: ResourceMetadata, cfg: Cfg): Record<string, PropertyOptions> {
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
  for (const [col, mapName] of Object.entries(cfg.badges ?? {})) {
    props[col] = {
      ...props[col],
      custom: { ...props[col]?.custom, badgeMap: mapName },
      components: { ...props[col]?.components, list: Components.StatusBadge, show: Components.StatusBadge },
    }
  }
  for (const [col, shape] of Object.entries(cfg.thumbs ?? {})) {
    props[col] = {
      ...props[col],
      custom: { ...props[col]?.custom, shape },
      components: { ...props[col]?.components, list: Components.Thumbnail, show: Components.Thumbnail },
    }
  }
  return props
}

export function buildResources(publicDb: SqlDatabase, authDb: SqlDatabase): ResourceWithOptions[] {
  return [...RESOURCES, AUTH_USERS].map((cfg) => {
    const db = cfg.schema === 'auth' ? authDb : publicDb
    const resource = db.table(cfg.table)
    // Replace the show BODY (not the action header → Onayla/Reddet/Edit/Delete survive).
    // event tables define no `show` action, so a clean override suffices; cast resolves
    // the RecordActionResponse↔ActionResponse variance from spreading typed actions.
    const baseActions = ACTIONS_BY_TABLE[cfg.table]
    const actions = (SHOW_COMPONENT_TABLES.has(cfg.table)
      ? { ...baseActions, show: { component: Components.RecordShow } }
      : baseActions) as ResourceOptions['actions']
    return {
      resource,
      options: {
        navigation: { name: cfg.nav },
        sort: cfg.sort,
        listProperties: cfg.list,
        showProperties: cfg.show,
        editProperties: cfg.edit,
        properties: buildProperties(resource, cfg),
        actions,
      },
    }
  })
}
