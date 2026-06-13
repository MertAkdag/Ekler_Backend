import type {
  Action,
  ActionContext,
  ActionRequest,
  BulkActionResponse,
  RecordActionResponse,
} from 'adminjs'
import { pool } from './db.js'
import { Components } from './components.js'

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
type BulkAction = Partial<Action<BulkActionResponse>>

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

/**
 * Notification `type` values that should_deliver_notification (02-schema.sql:2091)
 * treats as auto-critical → always delivered, bypassing user_settings. notifications
 * has NO table-level type CHECK, so these are the app's contract, not a DB constraint.
 */
type NotificationType = 'moderation_warning' | 'moderation_restriction' | 'security_system'

/**
 * Insert a user-facing notification. The admin pool is DB owner/superuser, so RLS
 * (notifications_insert_own) is not enforced — a direct insert with an arbitrary
 * recipient_id is allowed. Best-effort: a failed notify must never roll back a
 * committed sanction. Moderation types are auto-critical, so no should_deliver gate.
 */
async function notify(opts: {
  recipientId: string
  type: NotificationType
  title: string
  body: string
  data?: Record<string, unknown>
}): Promise<void> {
  try {
    await run(
      `insert into public.notifications (recipient_id, type, title, body, data)
       values ($1, $2, $3, $4, $5)`,
      [opts.recipientId, opts.type, opts.title, opts.body, opts.data ? JSON.stringify(opts.data) : null],
    )
  } catch (err) {
    // eslint-disable-next-line no-console
    console.error('user notification insert failed:', err)
  }
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
  type: 'warning' | 'temp_ban' | 'permanent_ban',
  reason: string,
  expiresInDays: number | null,
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
       values ($1, $2, $3, true,
         case when $4::int is null then null else now() + make_interval(days => $4::int) end)`,
      [userId, type, reason, expiresInDays],
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

const DEFAULT_SANCTION_REASON = 'Topluluk kurallarına aykırı davranış.'

/** Clamp a free-text duration_days payload to a sane integer (1..3650). */
function clampDays(raw: unknown): number {
  const days = Math.floor(Number(raw))
  if (!Number.isFinite(days) || days < 1) return 7
  return Math.min(days, 3650)
}

/**
 * ops_queue_items is machine-populated; the panel only drives state transitions:
 * open → in_progress (claim) → resolved | dismissed. owner_id is a uuid FK and
 * there is no admin uuid in the single-env panel, so `claim` only flips state
 * (never writes owner_id). All three route through recordAction → audit-logged.
 */
export function opsQueueActions(): Record<string, RecordAction> {
  return {
    claim: recordAction({
      icon: 'UserCheck',
      successMessage: 'İş üzerine alındı.',
      entityType: 'ops_queue_items',
      permissionKey: 'ops_queue.claim',
      action: 'claim',
      mutate: async (id) =>
        void (await run("update public.ops_queue_items set state = 'in_progress', updated_at = now() where id = $1", [id])),
    }),
    resolve: recordAction({
      icon: 'CheckCircle',
      successMessage: 'İş çözüldü olarak kapatıldı.',
      entityType: 'ops_queue_items',
      permissionKey: 'ops_queue.resolve',
      action: 'resolve',
      mutate: async (id) =>
        void (await run("update public.ops_queue_items set state = 'resolved', resolved_at = now(), updated_at = now() where id = $1", [id])),
    }),
    dismiss: recordAction({
      icon: 'XCircle',
      guard: 'Bu iş kaydını kapatmak istediğine emin misin?',
      successMessage: 'İş kaydı kapatıldı.',
      entityType: 'ops_queue_items',
      permissionKey: 'ops_queue.dismiss',
      action: 'dismiss',
      mutate: async (id) =>
        void (await run("update public.ops_queue_items set state = 'dismissed', updated_at = now() where id = $1", [id])),
    }),
  }
}

/**
 * Generic AdminJS v7 bulk action: GET renders the confirm drawer (echo records,
 * no mutation); POST runs one `update ... where id = any($1::uuid[])` for the
 * whole selection + a single summary audit row. component:false (no custom UI).
 */
function bulkUpdateAction(opts: {
  icon?: string
  variant?: 'primary' | 'danger' | 'success'
  noticeFor: (count: number) => string
  entityType: string
  permissionKey: string
  action: string
  reason: string
  /** SQL with $1 = uuid[] of selected ids; any extra placeholders ($2…) bind to `params`. */
  sql: string
  params?: unknown[]
}): BulkAction {
  return {
    actionType: 'bulk',
    icon: opts.icon,
    variant: opts.variant,
    component: false,
    showInDrawer: true,
    handler: async (
      request: ActionRequest,
      _response: unknown,
      context: ActionContext,
    ): Promise<BulkActionResponse> => {
      const { records, currentAdmin, h, resource } = context
      if (!records || records.length === 0) throw new Error('Kayıt seçilmedi.')
      const recordsJson = records.map((r) => r.toJSON(currentAdmin))
      if (request.method === 'get') return { records: recordsJson }

      const ids = records.map((r) => String(r.id()))
      await run(opts.sql, [ids, ...(opts.params ?? [])])
      await writeAudit({
        actorEmail: adminEmail(currentAdmin),
        permissionKey: opts.permissionKey,
        entityType: opts.entityType,
        entityId: ids.join(','),
        action: opts.action,
        reason: `${opts.reason} (${ids.length} kayıt)`,
      })
      return {
        records: recordsJson,
        notice: { message: opts.noticeFor(ids.length), type: 'success' },
        redirectUrl: h.resourceUrl({ resourceId: resource.id() }),
      }
    },
  }
}

/** Bulk-hide for confessions / confession_comments (shared moderation columns). */
export function contentBulkActions(table: 'confessions' | 'confession_comments'): Record<string, BulkAction> {
  return {
    bulkHide: bulkUpdateAction({
      icon: 'EyeOff',
      variant: 'danger',
      noticeFor: (count) => `${count} içerik gizlendi.`,
      entityType: table,
      permissionKey: `${table}.bulk_hide`,
      action: 'bulk_hide',
      reason: HIDE_REASON,
      sql: `update public.${table}
              set moderation_status = 'hidden', hidden_at = now(), restored_at = null, hidden_reason = $2
            where id = any($1::uuid[])`,
      params: [HIDE_REASON],
    }),
  }
}

/** Bulk-dismiss for reports. */
export function reportBulkActions(): Record<string, BulkAction> {
  return {
    bulkDismiss: bulkUpdateAction({
      icon: 'XCircle',
      noticeFor: (count) => `${count} şikayet reddedildi.`,
      entityType: 'reports',
      permissionKey: 'reports.bulk_dismiss',
      action: 'bulk_dismiss',
      reason: 'Toplu reddedildi.',
      sql: `update public.reports
              set status = 'dismissed', updated_at = now()
            where id = any($1::uuid[])`,
    }),
  }
}

/**
 * User moderation goes through user_sanctions (the source of truth) — the
 * sync_user_banned_status trigger derives profiles.is_banned / is_restricted /
 * restriction_ends_at from it. A profiles record's id() IS the user_id.
 *
 * `sanction` is parameterized: its custom component (SanctionForm) POSTs
 * { sanction_type, duration_days, reason }; the handler validates them, applies
 * the sanction via replaceActiveSanction, writes an audit row, and notifies the
 * user. `unban` stays one-click and also notifies (restriction lifted).
 */
export function userActions(): Record<string, RecordAction> {
  return {
    sanction: {
      actionType: 'record',
      icon: 'AlertTriangle',
      component: Components.SanctionForm,
      handler: async (request, _response, context) => {
        const { record, currentAdmin } = context
        if (!record) throw new Error('Kayıt bulunamadı.')
        const userId = String(record.id())

        // GET (initial render) → hand the record to the component, no mutation.
        if (request.method !== 'post') {
          return { record: record.toJSON(currentAdmin) }
        }

        const payload = request.payload ?? {}
        const rawType = String(payload.sanction_type ?? '')
        if (rawType !== 'warning' && rawType !== 'temp_ban' && rawType !== 'permanent_ban') {
          throw new Error('Geçersiz yaptırım türü.')
        }
        const sanctionType = rawType as 'warning' | 'temp_ban' | 'permanent_ban'
        const reason = String(payload.reason ?? '').trim() || DEFAULT_SANCTION_REASON

        let days: number | null = null
        if (sanctionType === 'temp_ban') {
          days = clampDays(payload.duration_days)
        }

        await replaceActiveSanction(userId, sanctionType, reason, days)

        if (sanctionType === 'warning') {
          await notify({
            recipientId: userId,
            type: 'moderation_warning',
            title: 'Uyarı aldınız',
            body: reason,
            data: { sanction_type: sanctionType },
          })
        } else {
          await notify({
            recipientId: userId,
            type: 'moderation_restriction',
            title: sanctionType === 'permanent_ban' ? 'Hesabınız kalıcı olarak kısıtlandı' : 'Hesabınız geçici olarak kısıtlandı',
            body:
              sanctionType === 'permanent_ban'
                ? `${reason} Bu karar kalıcıdır; itiraz edebilirsiniz.`
                : `${reason} Kısıtlama ${days} gün sürecektir; itiraz edebilirsiniz.`,
            data: { sanction_type: sanctionType, duration_days: days },
          })
        }

        await writeAudit({
          actorEmail: adminEmail(currentAdmin),
          permissionKey: 'users.sanction',
          entityType: 'profiles',
          entityId: userId,
          action: sanctionType,
          reason,
        })

        const labelTr =
          sanctionType === 'warning' ? 'Uyarı verildi.'
            : sanctionType === 'permanent_ban' ? 'Kullanıcı kalıcı olarak yasaklandı.'
              : `Kullanıcı ${days} gün geçici yasaklandı.`

        return {
          record: record.toJSON(currentAdmin),
          notice: { message: labelTr, type: 'success' },
        }
      },
    },
    unban: recordAction({
      icon: 'Check',
      successMessage: 'Kullanıcının yasağı kaldırıldı.',
      entityType: 'profiles',
      permissionKey: 'users.unban',
      action: 'unban',
      mutate: async (id) => {
        await run(
          'update public.user_sanctions set is_active = false where user_id = $1 and is_active = true',
          [id],
        )
        await notify({
          recipientId: id,
          type: 'moderation_restriction',
          title: 'Kısıtlamanız kaldırıldı',
          body: 'Hesabınızdaki yaptırım kaldırıldı. Topluluk kurallarına uymaya devam edin.',
          data: { event: 'restriction_lifted' },
        })
      },
    }),
  }
}
