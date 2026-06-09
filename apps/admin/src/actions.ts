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
 * Table names interpolated into SQL are hardcoded literals (never user input).
 */

type Mutator = (id: string) => Promise<void>
type RecordAction = Partial<Action<RecordActionResponse>>

function recordAction(opts: {
  icon?: string
  guard?: string
  successMessage: string
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
      await opts.mutate(record.id())
      return {
        record: record.toJSON(currentAdmin),
        notice: { message: opts.successMessage, type: 'success' },
      }
    },
  }
}

const run = (sql: string, params: unknown[]): Promise<unknown> => pool.query(sql, params)

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

/** confessions + confession_comments share the moderation_status / hidden_at columns. */
export function contentActions(table: 'confessions' | 'confession_comments'): Record<string, RecordAction> {
  return {
    hide: recordAction({
      icon: 'EyeOff',
      guard: 'Bu içeriği gizlemek istediğine emin misin?',
      successMessage: 'İçerik gizlendi.',
      mutate: async (id) =>
        void (await run(
          `update public.${table} set moderation_status = 'hidden', hidden_at = now(), restored_at = null where id = $1`,
          [id],
        )),
    }),
    publish: recordAction({
      icon: 'Eye',
      successMessage: 'İçerik yayınlandı.',
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
      mutate: async (id) => void (await run('update public.notes set is_hidden = true where id = $1', [id])),
    }),
    publish: recordAction({
      icon: 'Eye',
      successMessage: 'Not yayınlandı.',
      mutate: async (id) => void (await run('update public.notes set is_hidden = false where id = $1', [id])),
    }),
  }
}

export function reportActions(): Record<string, RecordAction> {
  return {
    review: recordAction({
      icon: 'CheckCircle',
      successMessage: 'Şikayet incelendi olarak işaretlendi.',
      mutate: async (id) =>
        void (await run("update public.reports set status = 'reviewed', updated_at = now() where id = $1", [id])),
    }),
    dismiss: recordAction({
      icon: 'XCircle',
      successMessage: 'Şikayet reddedildi.',
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
      mutate: async (id) =>
        void (await run('update public.communities set is_active = false, updated_at = now() where id = $1', [id])),
    }),
    activate: recordAction({
      icon: 'Check',
      successMessage: 'Topluluk aktifleştirildi.',
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
      mutate: async (id) =>
        void (await run("update public.event_submissions set status = 'approved', updated_at = now() where id = $1", [id])),
    }),
    reject: recordAction({
      icon: 'X',
      guard: 'Başvuruyu reddetmek istediğine emin misin?',
      successMessage: 'Başvuru reddedildi.',
      mutate: async (id) =>
        void (await run("update public.event_submissions set status = 'rejected', updated_at = now() where id = $1", [id])),
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
      mutate: (id) => replaceActiveSanction(id, 'permanent_ban', 'Yönetici tarafından yasaklandı.', null),
    }),
    tempBan: recordAction({
      icon: 'Clock',
      guard: '7 günlük geçici yasak uygulansın mı?',
      successMessage: 'Kullanıcı 7 gün geçici yasaklandı.',
      mutate: (id) =>
        replaceActiveSanction(id, 'temp_ban', 'Yönetici tarafından geçici yasaklandı.', "now() + interval '7 days'"),
    }),
    unban: recordAction({
      icon: 'Check',
      successMessage: 'Kullanıcının yasağı kaldırıldı.',
      mutate: async (id) =>
        void (await run(
          'update public.user_sanctions set is_active = false where user_id = $1 and is_active = true',
          [id],
        )),
    }),
  }
}
