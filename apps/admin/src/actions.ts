import type {
  Action,
  ActionContext,
  ActionRequest,
  RecordActionResponse,
} from 'adminjs'
import { pool } from './db.js'

/**
 * Moderation record-actions. Each runs an explicit parameterized write against the
 * shared pool (component:false → the button calls the handler directly, no custom UI).
 *
 * Every action also appends an admin_audit_logs row (who did what, to which entity)
 * so the panel has an accountability trail — until RBAC lands, actor_email is the
 * single env-admin. Audit is best-effort: it never fails an action that already
 * committed (the table has a DEFAULT partition, so the insert won't bounce on a
 * missing monthly partition).
 *
 * Table names interpolated into SQL are hardcoded literals (never user input).
 */

type Mutator = (id: string) => Promise<void>
type RecordAction = Partial<Action<RecordActionResponse>>

const run = (sql: string, params: unknown[]): Promise<unknown> => pool.query(sql, params)

interface AuditEntry {
  actorEmail: string | null
  permissionKey: string
  entityType: string
  entityId: string
  action: string
  reason: string | null
}

async function writeAudit(entry: AuditEntry): Promise<void> {
  try {
    await run(
      `insert into public.admin_audit_logs
         (actor_email, permission_key, entity_type, entity_id, action, reason)
       values ($1, $2, $3, $4, $5, $6)`,
      [entry.actorEmail, entry.permissionKey, entry.entityType, entry.entityId, entry.action, entry.reason],
    )
  } catch (err) {
    // Best-effort: the moderation write already committed; do not fail the action
    // because logging failed, but surface it for ops to notice.
    // eslint-disable-next-line no-console
    console.error('admin audit log write failed:', err)
  }
}

function adminEmail(currentAdmin: ActionContext['currentAdmin']): string | null {
  return currentAdmin && typeof currentAdmin.email === 'string' ? currentAdmin.email : null
}

function recordAction(opts: {
  icon?: string
  guard?: string
  successMessage: string
  /** audit: table the record lives in (entity_type). */
  entityType: string
  /** audit: semantic permission key, e.g. 'confessions.hide'. */
  permissionKey: string
  /** audit: short verb, e.g. 'hide'. */
  action: string
  /** audit: optional fixed reason. */
  reason?: string
  mutate: Mutator
}): RecordAction {
  return {
    actionType: 'record',
    icon: opts.icon,
    guard: opts.guard,
    component: false,
    handler: async (
      _request: ActionRequest,
      _response: unknown,
      context: ActionContext,
    ): Promise<RecordActionResponse> => {
      const { record, currentAdmin } = context
      if (!record) throw new Error('Kayıt bulunamadı.')
      const entityId = String(record.id())
      await opts.mutate(entityId)
      await writeAudit({
        actorEmail: adminEmail(currentAdmin),
        permissionKey: opts.permissionKey,
        entityType: opts.entityType,
        entityId,
        action: opts.action,
        reason: opts.reason ?? null,
      })
      return {
        record: record.toJSON(currentAdmin),
        notice: { message: opts.successMessage, type: 'success' },
      }
    },
  }
}

/** Deactivate any active sanction, then add a fresh one (preserves the single-active unique index). */
async function replaceActiveSanction(
  userId: string,
  type: 'temp_ban' | 'permanent_ban',
  reason: string,
  expiresAtSql: string | null,
): Promise<void> {
  const client = await pool.connect()
  try {
    await client.query('begin')
    await client.query(
      'update public.user_sanctions set is_active = false where user_id = $1 and is_active = true',
      [userId],
    )
    await client.query(
      `insert into public.user_sanctions (user_id, sanction_type, reason, is_active, expires_at)
       values ($1, $2, $3, true, ${expiresAtSql ?? 'null'})`,
      [userId, type, reason],
    )
    await client.query('commit')
  } catch (err) {
    await client.query('rollback')
    throw err
  } finally {
    client.release()
  }
}

const HIDE_REASON = 'Yönetici tarafından gizlendi.'
const REPORT_REMOVE_REASON = 'Şikayet üzerine kaldırıldı.'

/** related_entity_type / report target_type → the table holding that content. */
function contentTable(t: string | null): 'confessions' | 'confession_comments' | 'notes' | null {
  if (!t) return null
  const s = t.toLowerCase()
  if (s.includes('comment')) return 'confession_comments'
  if (s.includes('confession')) return 'confessions'
  if (s.includes('note')) return 'notes'
  return null
}

/** Re-publish a hidden confession/comment, or un-hide a note. */
async function unhideContent(client: import('pg').PoolClient, table: string, id: string): Promise<void> {
  if (table === 'notes') {
    await client.query('update public.notes set is_hidden = false where id = $1', [id])
  } else {
    await client.query(
      `update public.${table} set moderation_status = 'published', hidden_at = null, restored_at = now() where id = $1`,
      [id],
    )
  }
}

/** Hide a confession/comment (with reason) or a note, by target type. */
async function hideContent(client: import('pg').PoolClient, table: string, id: string, reason: string): Promise<void> {
  if (table === 'notes') {
    await client.query('update public.notes set is_hidden = true where id = $1', [id])
  } else {
    await client.query(
      `update public.${table} set moderation_status = 'hidden', hidden_at = now(), restored_at = null, hidden_reason = $2 where id = $1`,
      [id, reason],
    )
  }
}

/**
 * Accept an appeal AND act on what it contests (the whole point — a bare status
 * flip leaves the user still banned / content still hidden):
 *  - content_removal → re-publish the related content
 *  - sanction / account_ban → deactivate the sanction (by id, else the user's active one)
 * Then mark the appeal accepted. All in one transaction.
 */
async function acceptAppeal(id: string): Promise<void> {
  const client = await pool.connect()
  try {
    await client.query('begin')
    const { rows } = await client.query(
      `select appeal_type, related_entity_type, related_entity_id, sanction_id, user_id
       from public.moderation_appeals where id = $1 for update`,
      [id],
    )
    const a = rows[0]
    if (a) {
      if (a.appeal_type === 'content_removal' && a.related_entity_id) {
        const t = contentTable(a.related_entity_type)
        if (t) await unhideContent(client, t, a.related_entity_id)
      } else if (a.appeal_type === 'sanction' || a.appeal_type === 'account_ban') {
        if (a.sanction_id) {
          await client.query('update public.user_sanctions set is_active = false where id = $1', [a.sanction_id])
        } else if (a.user_id) {
          await client.query(
            'update public.user_sanctions set is_active = false where user_id = $1 and is_active = true',
            [a.user_id],
          )
        }
      }
    }
    await client.query(
      "update public.moderation_appeals set status = 'accepted', reviewed_at = now(), updated_at = now() where id = $1",
      [id],
    )
    await client.query('commit')
  } catch (err) {
    await client.query('rollback')
    throw err
  } finally {
    client.release()
  }
}

/**
 * Resolve a report AND act on its target in one step: hide the reported content
 * (confession/comment/note) then mark the report reviewed. User-target reports
 * have no content to hide, so they are just marked reviewed (ban the user from
 * the Profiles screen). One transaction.
 */
async function removeReportTarget(id: string): Promise<void> {
  const client = await pool.connect()
  try {
    await client.query('begin')
    const { rows } = await client.query(
      'select target_type, target_id from public.reports where id = $1 for update',
      [id],
    )
    const r = rows[0]
    const t = contentTable(r?.target_type ?? null)
    if (r && t && r.target_id) await hideContent(client, t, r.target_id, REPORT_REMOVE_REASON)
    await client.query("update public.reports set status = 'reviewed', updated_at = now() where id = $1", [id])
    await client.query('commit')
  } catch (err) {
    await client.query('rollback')
    throw err
  } finally {
    client.release()
  }
}

/** confessions + confession_comments share the moderation_status / hidden_at columns. */
export function contentActions(table: 'confessions' | 'confession_comments'): Record<string, RecordAction> {
  return {
    hide: recordAction({
      icon: 'EyeOff',
      guard: 'Bu içeriği gizlemek istediğine emin misin?',
      successMessage: 'İçerik gizlendi.',
      entityType: table,
      permissionKey: `${table}.hide`,
      action: 'hide',
      reason: 'Yönetici içeriği gizledi.',
      mutate: async (id) =>
        void (await run(
          `update public.${table} set moderation_status = 'hidden', hidden_at = now(), restored_at = null, hidden_reason = $2 where id = $1`,
          [id, HIDE_REASON],
        )),
    }),
    publish: recordAction({
      icon: 'Eye',
      successMessage: 'İçerik yayınlandı.',
      entityType: table,
      permissionKey: `${table}.publish`,
      action: 'publish',
      mutate: async (id) =>
        void (await run(
          `update public.${table} set moderation_status = 'published', hidden_at = null, restored_at = now() where id = $1`,
          [id],
        )),
    }),
  }
}

export function noteActions(): Record<string, RecordAction> {
  return {
    hide: recordAction({
      icon: 'EyeOff',
      guard: 'Bu notu gizlemek istediğine emin misin?',
      successMessage: 'Not gizlendi.',
      entityType: 'notes',
      permissionKey: 'notes.hide',
      action: 'hide',
      mutate: async (id) => void (await run('update public.notes set is_hidden = true where id = $1', [id])),
    }),
    publish: recordAction({
      icon: 'Eye',
      successMessage: 'Not yayınlandı.',
      entityType: 'notes',
      permissionKey: 'notes.publish',
      action: 'publish',
      mutate: async (id) => void (await run('update public.notes set is_hidden = false where id = $1', [id])),
    }),
  }
}

export function reportActions(): Record<string, RecordAction> {
  return {
    removeTarget: recordAction({
      icon: 'Trash2',
      guard: 'Şikayet edilen içeriği kaldırıp şikayeti kapatmak istediğine emin misin?',
      successMessage: 'İçerik kaldırıldı ve şikayet kapatıldı.',
      entityType: 'reports',
      permissionKey: 'reports.remove_target',
      action: 'remove_target',
      reason: REPORT_REMOVE_REASON,
      mutate: removeReportTarget,
    }),
    review: recordAction({
      icon: 'CheckCircle',
      successMessage: 'Şikayet incelendi olarak işaretlendi.',
      entityType: 'reports',
      permissionKey: 'reports.review',
      action: 'review',
      mutate: async (id) =>
        void (await run("update public.reports set status = 'reviewed', updated_at = now() where id = $1", [id])),
    }),
    dismiss: recordAction({
      icon: 'XCircle',
      successMessage: 'Şikayet reddedildi.',
      entityType: 'reports',
      permissionKey: 'reports.dismiss',
      action: 'dismiss',
      mutate: async (id) =>
        void (await run("update public.reports set status = 'dismissed', updated_at = now() where id = $1", [id])),
    }),
  }
}

export function communityActions(): Record<string, RecordAction> {
  return {
    deactivate: recordAction({
      icon: 'Slash',
      guard: 'Topluluğu pasifleştirmek istediğine emin misin?',
      successMessage: 'Topluluk pasifleştirildi.',
      entityType: 'communities',
      permissionKey: 'communities.deactivate',
      action: 'deactivate',
      mutate: async (id) =>
        void (await run('update public.communities set is_active = false, updated_at = now() where id = $1', [id])),
    }),
    activate: recordAction({
      icon: 'Check',
      successMessage: 'Topluluk aktifleştirildi.',
      entityType: 'communities',
      permissionKey: 'communities.activate',
      action: 'activate',
      mutate: async (id) =>
        void (await run('update public.communities set is_active = true, updated_at = now() where id = $1', [id])),
    }),
  }
}

export function eventSubmissionActions(): Record<string, RecordAction> {
  return {
    approve: recordAction({
      icon: 'Check',
      successMessage: 'Başvuru onaylandı.',
      entityType: 'event_submissions',
      permissionKey: 'event_submissions.approve',
      action: 'approve',
      mutate: async (id) =>
        void (await run("update public.event_submissions set status = 'approved', updated_at = now() where id = $1", [id])),
    }),
    reject: recordAction({
      icon: 'X',
      guard: 'Başvuruyu reddetmek istediğine emin misin?',
      successMessage: 'Başvuru reddedildi.',
      entityType: 'event_submissions',
      permissionKey: 'event_submissions.reject',
      action: 'reject',
      mutate: async (id) =>
        void (await run("update public.event_submissions set status = 'rejected', updated_at = now() where id = $1", [id])),
    }),
  }
}

/** Topluluk açma başvuruları (public form → moderatör onayı). */
export function communityRequestActions(): Record<string, RecordAction> {
  return {
    approve: recordAction({
      icon: 'Check',
      successMessage: 'Topluluk başvurusu onaylandı.',
      entityType: 'community_requests',
      permissionKey: 'community_requests.approve',
      action: 'approve',
      mutate: async (id) =>
        void (await run("update public.community_requests set status = 'approved', updated_at = now() where id = $1", [id])),
    }),
    reject: recordAction({
      icon: 'X',
      guard: 'Başvuruyu reddetmek istediğine emin misin?',
      successMessage: 'Topluluk başvurusu reddedildi.',
      entityType: 'community_requests',
      permissionKey: 'community_requests.reject',
      action: 'reject',
      mutate: async (id) =>
        void (await run("update public.community_requests set status = 'rejected', updated_at = now() where id = $1", [id])),
    }),
  }
}

/** Moderasyon kararına gelen itirazlar (sanction / içerik kaldırma / hesap banı). */
export function appealActions(): Record<string, RecordAction> {
  return {
    accept: recordAction({
      icon: 'Check',
      guard: 'İtirazı kabul edip ilgili yaptırımı/içeriği geri almak istediğine emin misin?',
      successMessage: 'İtiraz kabul edildi; ilgili yaptırım/içerik geri alındı.',
      entityType: 'moderation_appeals',
      permissionKey: 'moderation_appeals.accept',
      action: 'accept',
      mutate: acceptAppeal,
    }),
    rejectAppeal: recordAction({
      icon: 'X',
      successMessage: 'İtiraz reddedildi.',
      entityType: 'moderation_appeals',
      permissionKey: 'moderation_appeals.reject',
      action: 'reject',
      mutate: async (id) =>
        void (await run(
          "update public.moderation_appeals set status = 'rejected', reviewed_at = now(), updated_at = now() where id = $1",
          [id],
        )),
    }),
  }
}

/**
 * @adminjs/sql `before` hook for moderation_word_rules new + edit. Panel-created
 * rules otherwise leave normalized_pattern blank, and the live engine
 * evaluate_moderation_rules only matches exact_token/contains rules when
 * coalesce(normalized_pattern,'') <> '' (02-schema.sql L732/L735) — so such rules
 * SILENTLY never fire. We derive normalized_pattern with the DB's own
 * normalize_moderation_text(text)->text so panel rules behave like seeded ones.
 * GET (form render) has no payload; a missing/empty NOT NULL pattern is left for
 * native validation. regex rules use raw pattern so the value is harmless for them.
 */
export async function wordRuleNormalizeBefore(
  request: ActionRequest,
  _context: ActionContext,
): Promise<ActionRequest> {
  if (request.method !== 'post') return request
  const payload = request.payload
  if (!payload) return request
  const raw = payload.pattern
  if (typeof raw !== 'string' || raw.trim() === '') return request
  const res = await pool.query<{ np: string | null }>('select public.normalize_moderation_text($1) as np', [raw])
  request.payload = { ...payload, normalized_pattern: res.rows[0]?.np ?? '' }
  return request
}

/** Otomatik moderasyon kelime kuralları — panelden hızlı aç/kapat. */
export function wordRuleActions(): Record<string, RecordAction> {
  return {
    enableRule: recordAction({
      icon: 'Check',
      successMessage: 'Kural aktifleştirildi.',
      entityType: 'moderation_word_rules',
      permissionKey: 'moderation_word_rules.enable',
      action: 'enable',
      mutate: async (id) =>
        void (await run('update public.moderation_word_rules set enabled = true, updated_at = now() where id = $1', [id])),
    }),
    disableRule: recordAction({
      icon: 'Slash',
      guard: 'Bu kuralı devre dışı bırakmak istediğine emin misin?',
      successMessage: 'Kural devre dışı bırakıldı.',
      entityType: 'moderation_word_rules',
      permissionKey: 'moderation_word_rules.disable',
      action: 'disable',
      mutate: async (id) =>
        void (await run('update public.moderation_word_rules set enabled = false, updated_at = now() where id = $1', [id])),
    }),
  }
}

/**
 * User moderation goes through user_sanctions (the source of truth) — the
 * sync_user_banned_status trigger derives profiles.is_banned / is_restricted /
 * restriction_ends_at from it. A profiles record's id() IS the user_id.
 */
export function userActions(): Record<string, RecordAction> {
  return {
    ban: recordAction({
      icon: 'Slash',
      guard: 'Bu kullanıcıyı KALICI yasaklamak istediğine emin misin?',
      successMessage: 'Kullanıcı kalıcı olarak yasaklandı.',
      entityType: 'profiles',
      permissionKey: 'users.ban',
      action: 'ban',
      reason: 'Yönetici tarafından kalıcı yasaklandı.',
      mutate: (id) => replaceActiveSanction(id, 'permanent_ban', 'Yönetici tarafından yasaklandı.', null),
    }),
    tempBan: recordAction({
      icon: 'Clock',
      guard: '7 günlük geçici yasak uygulansın mı?',
      successMessage: 'Kullanıcı 7 gün geçici yasaklandı.',
      entityType: 'profiles',
      permissionKey: 'users.temp_ban',
      action: 'temp_ban',
      reason: 'Yönetici tarafından 7 gün geçici yasaklandı.',
      mutate: (id) =>
        replaceActiveSanction(id, 'temp_ban', 'Yönetici tarafından geçici yasaklandı.', "now() + interval '7 days'"),
    }),
    unban: recordAction({
      icon: 'Check',
      successMessage: 'Kullanıcının yasağı kaldırıldı.',
      entityType: 'profiles',
      permissionKey: 'users.unban',
      action: 'unban',
      mutate: async (id) =>
        void (await run(
          'update public.user_sanctions set is_active = false where user_id = $1 and is_active = true',
          [id],
        )),
    }),
  }
}
