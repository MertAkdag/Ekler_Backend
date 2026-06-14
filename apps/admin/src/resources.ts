import type { PropertyOptions, ResourceOptions, ResourceWithOptions } from 'adminjs'
import type { ResourceMetadata } from '@adminjs/sql'
import {
  appealActions,
  communityActions,
  communityRequestActions,
  contentActions,
  contentBulkActions,
  courseSuggestionActions,
  eventSubmissionActions,
  noteActions,
  opsQueueActions,
  reportActions,
  reportBulkActions,
  userActions,
  wordRuleActions,
  wordRuleNormalizeBefore,
} from './actions.js'
import { Components } from './components.js'
import { signImagesAfter } from './storage.js'

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
  /** view-only: new/edit/delete/bulkDelete disabled (audit/log/derived tables). */
  readonly?: boolean
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
  'endorsement_count',
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
  {
    table: 'moderation_appeals',
    nav: 'Moderasyon',
    sort: { sortBy: 'created_at', direction: 'desc' },
    list: ['appeal_type', 'related_entity_type', 'status', 'user_id', 'reviewed_by', 'created_at'],
    badges: { status: 'appeal_status', appeal_type: 'appeal_type' },
  },
  {
    table: 'ops_queue_items',
    nav: 'Moderasyon',
    sort: { sortBy: 'created_at', direction: 'desc' },
    list: ['queue_domain', 'title', 'severity', 'state', 'owner_id', 'due_at', 'created_at'],
    badges: { queue_domain: 'queue_domain', severity: 'severity', state: 'ops_state' },
    // Machine-populated queue; only state transitions allowed (claim/resolve/dismiss).
    readonly: true,
  },
  {
    table: 'moderation_word_rules',
    nav: 'Moderasyon',
    sort: { sortBy: 'rule_key', direction: 'asc' },
    list: ['rule_key', 'scope', 'category', 'match_type', 'action', 'severity', 'enabled'],
    badges: {
      scope: 'rule_scope', category: 'word_category', match_type: 'match_type',
      action: 'word_action', severity: 'severity', enabled: 'bool_enabled',
    },
    edit: ['rule_key', 'scope', 'category', 'match_type', 'pattern', 'action', 'severity', 'enabled', 'notes'],
  },
  {
    table: 'moderation_scan_logs',
    nav: 'Moderasyon',
    sort: { sortBy: 'created_at', direction: 'desc' },
    list: ['content_scope', 'decision', 'moderation_label', 'source', 'created_at'],
    badges: { content_scope: 'scan_scope', decision: 'scan_decision' },
    readonly: true,
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
  {
    table: 'community_requests',
    nav: 'İçerik',
    sort: { sortBy: 'created_at', direction: 'desc' },
    list: ['community_name', 'contact_name', 'university_domain', 'category', 'status', 'created_at'],
    badges: { status: 'submission_status' },
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
    table: 'course_suggestions',
    nav: 'Katalog',
    // Most-endorsed pending suggestions first (the ones worth approving).
    sort: { sortBy: 'endorsement_count', direction: 'desc' },
    list: ['code', 'name', 'department_id', 'university_domain', 'endorsement_count', 'status', 'created_at'],
    badges: { status: 'submission_status' },
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
  {
    table: 'push_campaigns',
    nav: 'Sistem',
    sort: { sortBy: 'created_at', direction: 'desc' },
    list: ['title', 'status', 'target_platform', 'dry_run_total', 'sent_at', 'created_at'],
    badges: { status: 'push_status', target_platform: 'target_platform' },
    // View-only: actual sending is a worker job, not wired here — editable rows
    // would let an admin create campaigns that never send.
    readonly: true,
  },
  {
    table: 'admin_incident_events',
    nav: 'Sistem',
    sort: { sortBy: 'created_at', direction: 'desc' },
    list: ['title', 'severity', 'status', 'started_at', 'resolved_at', 'created_at'],
    badges: { severity: 'severity', status: 'incident_status' },
  },
]

/** auth.users lives in the `auth` schema → separate adapter, its own config. */
const AUTH_USERS: Cfg = {
  table: 'users',
  nav: 'Kullanıcılar',
  schema: 'auth',
  sort: { sortBy: 'created_at', direction: 'desc' },
  // standalone shell auth.users has no last_sign_in_at; updated_at is the closest signal.
  list: ['email', 'phone', 'email_confirmed_at', 'updated_at', 'banned_until', 'created_at'],
}

interface SqlDatabase {
  table(name: string): ResourceMetadata
}

/** Moderation actions per table (merged with AdminJS default actions). */
const ACTIONS_BY_TABLE: Record<string, ResourceOptions['actions']> = {
  confessions: { ...contentActions('confessions'), ...contentBulkActions('confessions') },
  confession_comments: { ...contentActions('confession_comments'), ...contentBulkActions('confession_comments') },
  notes: noteActions(),
  reports: { ...reportActions(), ...reportBulkActions() },
  communities: communityActions(),
  course_suggestions: courseSuggestionActions(),
  event_submissions: eventSubmissionActions(),
  community_requests: communityRequestActions(),
  moderation_appeals: appealActions(),
  moderation_word_rules: {
    ...wordRuleActions(),
    // Derive normalized_pattern on create/edit so panel rules actually match in
    // the live engine (blank normalized_pattern never fires for exact_token/contains).
    new: { before: wordRuleNormalizeBefore },
    edit: { before: wordRuleNormalizeBefore },
  },
  ops_queue_items: opsQueueActions(),
  profiles: userActions(),
}

/** View-only override: disable every mutating action (merged last). */
const READONLY_ACTIONS: ResourceOptions['actions'] = {
  new: { isAccessible: false },
  edit: { isAccessible: false },
  delete: { isAccessible: false },
  bulkDelete: { isAccessible: false },
}

/**
 * Tables whose PRIMARY KEY column is ALSO a foreign key (e.g. profiles.id →
 * auth.users.id). @adminjs/sql's introspection types such a column as
 * 'reference' and — because its column query joins key_column_usage without
 * filtering on constraint — emits a duplicate non-PK `id` row that shadows the
 * isId one. AdminJS then can't find an isId property and every record action
 * (show/edit) fails with "You have to pass a valid recordId to the recordAction".
 * Re-assert the real id property for these tables.
 */
const ID_OVERRIDE_TABLES = new Set(['profiles'])

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
    const actions = {
      ...baseActions,
      ...(SHOW_COMPONENT_TABLES.has(cfg.table)
        ? { show: { component: Components.RecordShow, after: signImagesAfter(cfg.table) } }
        : {}),
      ...(cfg.readonly ? READONLY_ACTIONS : {}),
    } as ResourceOptions['actions']
    // Only include showProperties/editProperties when actually set: AdminJS spreads
    // list-option arrays unconditionally (build-feature.js), so a present-but-undefined
    // key (`[...undefined]`) crashes boot with "is not iterable".
    const options: ResourceOptions = {
      navigation: { name: cfg.nav },
      sort: cfg.sort,
      listProperties: cfg.list,
      properties: buildProperties(resource, cfg),
      actions,
    }
    if (cfg.show) options.showProperties = cfg.show
    if (cfg.edit) options.editProperties = cfg.edit
    // PK-is-also-FK introspection fix (see ID_OVERRIDE_TABLES): force the id
    // property so record actions resolve a valid recordId.
    if (ID_OVERRIDE_TABLES.has(cfg.table)) {
      options.properties = {
        ...options.properties,
        id: { ...options.properties?.id, isId: true, type: 'uuid' },
      }
    }
    return { resource, options }
  })
}
