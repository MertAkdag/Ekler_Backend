import type { QueryResultRow } from 'pg'
import { pool } from './db.js'

/**
 * Moderation-cockpit dashboard payload. One handler fans out parallel queries,
 * each wrapped in safe() so a single failing/empty table can never take the whole
 * dashboard down (the page just renders that section empty).
 *
 * Day boundaries use Europe/Istanbul so "today/yesterday/14d" match Turkey
 * regardless of the pool's session timezone.
 *
 * hrefs are built HERE (server) using only URL formats verified reliable:
 *  - filtered list:  /admin/resources/<table>/actions/list?filters.<col>=<val>
 *  - record show:    /admin/resources/<table>/records/<id>/show
 * Boolean filters (is_flagged=true) and exact status filters are reliable.
 * DATE "today" filters are NOT, so signups_today/confessions_today link to the
 * default-sorted list (created_at desc); the KPI counts themselves are exact.
 */

const ROOT = '/admin'
const TZ = `at time zone 'Europe/Istanbul'`

function listHref(table: string, col?: string, value?: string): string {
  if (!col || value === undefined) return `${ROOT}/resources/${table}/actions/list`
  return `${ROOT}/resources/${table}/actions/list?filters.${col}=${encodeURIComponent(value)}`
}
function showHref(table: string, id: string | number): string {
  return `${ROOT}/resources/${table}/records/${encodeURIComponent(String(id))}/show`
}

const n = (v: string | number | null | undefined): number => Number(v ?? 0)

/** Turkish relative time: "az önce", "5 dakika önce", "3 saat önce", "2 gün önce". */
function relTr(iso: string | null | undefined): string {
  if (!iso) return ''
  const then = new Date(iso).getTime()
  if (Number.isNaN(then)) return ''
  const sec = Math.max(0, Math.floor((Date.now() - then) / 1000))
  if (sec < 45) return 'az önce'
  const min = Math.floor(sec / 60)
  if (min < 60) return `${min} dakika önce`
  const hr = Math.floor(min / 60)
  if (hr < 24) return `${hr} saat önce`
  const day = Math.floor(hr / 24)
  if (day < 30) return `${day} gün önce`
  const mon = Math.floor(day / 30)
  if (mon < 12) return `${mon} ay önce`
  return `${Math.floor(mon / 12)} yıl önce`
}

/** Due-time: overdue → "X gün gecikti", else "X saat kaldı". null due → no label. */
function dueTr(iso: string | null | undefined): { text: string; overdue: boolean } | null {
  if (!iso) return null
  const t = new Date(iso).getTime()
  if (Number.isNaN(t)) return null
  const diffSec = Math.floor((t - Date.now()) / 1000)
  const overdue = diffSec < 0
  const abs = Math.abs(diffSec)
  const hr = Math.floor(abs / 3600)
  const day = Math.floor(hr / 24)
  const span = day >= 1 ? `${day} gün` : `${Math.max(1, hr)} saat`
  return { text: overdue ? `${span} gecikti` : `${span} kaldı`, overdue }
}

export type Tone = 'ok' | 'warn' | 'crit'

/** Threshold→tone for "attention" metrics: 0 = ok(green), low = warn(amber), high = crit(red). */
function attentionTone(value: number, warnAt: number, critAt: number): Tone {
  if (value >= critAt) return 'crit'
  if (value >= warnAt) return 'warn'
  return 'ok'
}

export interface Kpi {
  key: string
  label: string
  value: number
  delta: number | null
  href: string
  icon: string
  tone: Tone
}
export interface QueueItem {
  id: string
  targetType: string
  targetLabel: string
  reason: string
  rel: string
  href: string
}
export interface FlaggedItem {
  id: string
  source: string
  sourceLabel: string
  flagKind: 'user' | 'auto'
  label: string | null
  snippet: string
  university: string | null
  rel: string
  href: string
}
export interface AppealItem {
  id: string
  typeLabel: string
  reason: string
  rel: string
  href: string
}
export interface OpsItem {
  id: string
  domainLabel: string
  title: string
  severity: string
  state: string
  owned: boolean
  due: { text: string; overdue: boolean } | null
  rel: string
  href: string
}
export interface BreakdownRow {
  key: string
  label: string
  count: number
  href: string | null
}
export interface AuditItem {
  actor: string
  actionLabel: string
  entityLabel: string
  reason: string | null
  rel: string
}
export interface RiskyUser {
  id: string
  username: string
  count: number
  href: string
}
export interface TrendPoint {
  label: string
  value: number
}
export interface ActivityPoint {
  label: string
  content: number
  reports: number
}
export interface ScanSummary {
  allow: number
  review: number
  block: number
  blockRate: number
  topTerms: { term: string; count: number }[]
}
export interface TopUniversity {
  domain: string
  name: string
  total: number
  href: string
}
export interface TopCommunity {
  name: string
  members: number
  university: string | null
}
export interface DashboardPayload {
  kpis: Kpi[]
  reportQueue: QueueItem[]
  flaggedContent: FlaggedItem[]
  appealQueue: AppealItem[]
  opsQueue: OpsItem[]
  reportsByReason: BreakdownRow[]
  reportsByTarget: BreakdownRow[]
  activeSanctions: BreakdownRow[]
  signupTrend: TrendPoint[]
  activityTrend: ActivityPoint[]
  topUniversities: TopUniversity[]
  topCommunities: TopCommunity[]
  riskyUsers: RiskyUser[]
  scanSummary: ScanSummary
  recentActions: AuditItem[]
  generatedAt: string
}

// ---- SQL (parameterless; counts come back as strings) -------------------

const SQL_KPIS = `
  with b as (
    select
      date_trunc('day', now() ${TZ})                    as today_start,
      date_trunc('day', now() ${TZ}) - interval '1 day' as yday_start,
      (now() ${TZ}) - date_trunc('day', now() ${TZ})    as elapsed_today
  )
  select
    (select count(*) from public.reports             where status = 'pending')                          as pending_reports,
    (select count(*) from public.moderation_appeals  where status in ('pending','under_review'))         as pending_appeals,
    (select count(*) from public.confessions         where moderation_status = 'needs_review')
      + (select count(*) from public.confession_comments where moderation_status = 'needs_review')        as needs_review,
    (select count(*) from public.confessions         where is_flagged = true)                            as flagged_confessions,
    (select count(*) from public.confession_comments where is_flagged = true)                            as flagged_comments,
    (select count(*) from public.notes               where is_flagged = true)                            as flagged_notes,
    (select count(*) from public.ops_queue_items     where state in ('open','in_progress') and due_at is not null and due_at < now()) as sla_breaches,
    (select count(*) from public.event_submissions   where status = 'pending')                           as pending_events,
    (select count(*) from public.community_requests  where status = 'pending')                           as pending_community_requests,
    (select count(*) from public.user_sanctions      where is_active = true)                             as active_sanctions,
    (select count(*) from public.study_sessions      where status in ('active','full'))                  as active_sessions,
    (select count(*) from public.profiles)                                                               as total_users,
    (select count(*) from public.profiles, b    where (created_at ${TZ}) >= b.today_start)               as signups_today,
    -- yesterday-SO-FAR (same elapsed window) so the morning delta is a fair
    -- intraday comparison, not "today's first hour vs all of yesterday".
    (select count(*) from public.profiles, b    where (created_at ${TZ}) >= b.yday_start and (created_at ${TZ}) < b.yday_start + b.elapsed_today) as signups_yesterday,
    (select count(*) from public.confessions, b where (created_at ${TZ}) >= b.today_start)               as confessions_today,
    (select count(*) from public.confessions, b where (created_at ${TZ}) >= b.yday_start and (created_at ${TZ}) < b.yday_start + b.elapsed_today) as confessions_yesterday
`

const SQL_QUEUE = `
  select id, target_type, reason, created_at
  from public.reports
  where status = 'pending'
  order by created_at desc
  limit 8
`

const SQL_FLAGGED = `
  (
    select c.id::text as id, 'confession'::text as source, left(c.body, 140) as snippet,
           c.university_domain as university,
           case when c.is_flagged then 'user' else 'auto' end as flag_kind,
           c.moderation_label as label, c.created_at
    from public.confessions c
    where c.is_flagged = true or c.moderation_status = 'needs_review'
  )
  union all
  (
    select cc.id::text as id, 'comment'::text as source, left(cc.body, 140) as snippet,
           c2.university_domain as university,
           case when cc.is_flagged then 'user' else 'auto' end as flag_kind,
           cc.moderation_label as label, cc.created_at
    from public.confession_comments cc
    join public.confessions c2 on c2.id = cc.confession_id
    where cc.is_flagged = true or cc.moderation_status = 'needs_review'
  )
  union all
  (
    select n.id::text as id, 'note'::text as source, left(n.title, 140) as snippet,
           n.university_domain as university,
           'user'::text as flag_kind, null::text as label, n.created_at
    from public.notes n
    where n.is_flagged = true or n.is_hidden = true
  )
  order by created_at desc
  limit 10
`

const SQL_APPEALS = `
  select id, appeal_type, reason, created_at
  from public.moderation_appeals
  where status in ('pending', 'under_review')
  order by created_at asc
  limit 8
`

// P0 first, then by due time (overdue first). nulls last.
const SQL_OPS = `
  select id, queue_domain, title, severity, state, owner_id, due_at, created_at
  from public.ops_queue_items
  where state in ('open', 'in_progress')
  order by case severity when 'P0' then 0 when 'P1' then 1 when 'P2' then 2 else 3 end,
           due_at asc nulls last
  limit 8
`

const SQL_REPORTS_BY_REASON = `
  select reason, count(*)::int as nn
  from public.reports
  where status = 'pending'
  group by reason
  order by nn desc
  limit 6
`

const SQL_REPORTS_BY_TARGET = `
  select target_type, count(*)::int as nn
  from public.reports
  where status = 'pending'
  group by target_type
  order by nn desc
`

const SQL_SANCTIONS = `
  select sanction_type, count(*)::int as nn
  from public.user_sanctions
  where is_active = true
  group by sanction_type
  order by nn desc
`

const SQL_TREND = `
  with days as (
    select generate_series(
      date_trunc('day', now() ${TZ}) - interval '13 days',
      date_trunc('day', now() ${TZ}),
      interval '1 day'
    ) as day
  ),
  counts as (
    select date_trunc('day', created_at ${TZ}) as day, count(*) as nn
    from public.profiles
    where (created_at ${TZ}) >= date_trunc('day', now() ${TZ}) - interval '13 days'
    group by 1
  )
  select d.day::date as day, coalesce(c.nn, 0)::int as signups
  from days d
  left join counts c on c.day = d.day
  order by d.day asc
`

// 14-day content (confessions + comments) and report volume — spam/raid signal.
const SQL_ACTIVITY = `
  with days as (
    select generate_series(
      date_trunc('day', now() ${TZ}) - interval '13 days',
      date_trunc('day', now() ${TZ}),
      interval '1 day'
    ) as day
  ),
  conf as (
    select date_trunc('day', created_at ${TZ}) as day, count(*) as nn from public.confessions
    where (created_at ${TZ}) >= date_trunc('day', now() ${TZ}) - interval '13 days' group by 1
  ),
  comm as (
    select date_trunc('day', created_at ${TZ}) as day, count(*) as nn from public.confession_comments
    where (created_at ${TZ}) >= date_trunc('day', now() ${TZ}) - interval '13 days' group by 1
  ),
  rep as (
    select date_trunc('day', created_at ${TZ}) as day, count(*) as nn from public.reports
    where (created_at ${TZ}) >= date_trunc('day', now() ${TZ}) - interval '13 days' group by 1
  )
  select d.day::date as day,
         (coalesce(conf.nn,0) + coalesce(comm.nn,0))::int as content,
         coalesce(rep.nn,0)::int as reports
  from days d
  left join conf on conf.day = d.day
  left join comm on comm.day = d.day
  left join rep  on rep.day  = d.day
  order by d.day asc
`

const SQL_SCAN_TODAY = `
  select
    count(*) filter (where decision = 'allow')  as allow,
    count(*) filter (where decision = 'review') as review,
    count(*) filter (where decision = 'block')  as block
  from public.moderation_scan_logs
  where (created_at ${TZ}) >= date_trunc('day', now() ${TZ})
`

const SQL_SCAN_TERMS = `
  select term, count(*)::int as nn
  from public.moderation_scan_logs s
  cross join lateral unnest(s.matched_terms) as term
  where (s.created_at ${TZ}) >= date_trunc('day', now() ${TZ})
  group by term
  order by nn desc
  limit 5
`

const SQL_RISKY_USERS = `
  select r.target_id::text as id, p.username, count(*)::int as nn
  from public.reports r
  join public.profiles p on p.id = r.target_id
  where r.target_type = 'user' and r.status = 'pending'
  group by r.target_id, p.username
  order by nn desc
  limit 5
`

const SQL_RECENT_AUDIT = `
  select actor_email, action, entity_type, reason, created_at
  from public.admin_audit_logs
  order by created_at desc
  limit 8
`

const SQL_TOP_UNIS = `
  with conf as (select university_domain as domain, count(*) as nn from public.confessions    group by 1),
  nt   as (select university_domain as domain, count(*) as nn from public.notes          group by 1),
  comm as (select university_domain as domain, count(*) as nn from public.communities    group by 1),
  sess as (select university_domain as domain, count(*) as nn from public.study_sessions group by 1),
  domains as (
    select domain from conf union select domain from nt
    union select domain from comm union select domain from sess
  )
  select
    d.domain as domain,
    u.name   as name,
    (coalesce(conf.nn,0) + coalesce(nt.nn,0) + coalesce(comm.nn,0) + coalesce(sess.nn,0))::int as total
  from domains d
  left join conf on conf.domain = d.domain
  left join nt   on nt.domain   = d.domain
  left join comm on comm.domain = d.domain
  left join sess on sess.domain = d.domain
  left join public.universities u on u.domain = d.domain
  where d.domain is not null
  order by total desc, d.domain asc
  limit 5
`

const SQL_TOP_COMMUNITIES = `
  select name, member_count, university_domain
  from public.communities
  where is_active = true
  order by member_count desc, name asc
  limit 5
`

interface KpiRow {
  pending_reports: string; pending_appeals: string; needs_review: string
  flagged_confessions: string; flagged_comments: string; flagged_notes: string
  sla_breaches: string; pending_events: string; pending_community_requests: string
  active_sanctions: string; active_sessions: string; total_users: string
  signups_today: string; signups_yesterday: string
  confessions_today: string; confessions_yesterday: string
}
interface QueueRow { id: string | number; target_type: string | null; reason: string | null; created_at: string }
interface FlaggedRow { id: string; source: string; snippet: string | null; university: string | null; flag_kind: string; label: string | null; created_at: string }
interface AppealRow { id: string | number; appeal_type: string | null; reason: string | null; created_at: string }
interface OpsRow { id: string | number; queue_domain: string | null; title: string | null; severity: string | null; state: string | null; owner_id: string | null; due_at: string | null; created_at: string }
interface ReasonRow { reason: string | null; nn: number }
interface TargetRow { target_type: string | null; nn: number }
interface SanctionRow { sanction_type: string | null; nn: number }
interface TrendRow { day: string; signups: number }
interface ActivityRow { day: string; content: number; reports: number }
interface ScanRow { allow: string; review: string; block: string }
interface TermRow { term: string; nn: number }
interface RiskyRow { id: string; username: string | null; nn: number }
interface AuditRow { actor_email: string | null; action: string | null; entity_type: string | null; reason: string | null; created_at: string }
interface UniRow { domain: string; name: string | null; total: number }
interface CommRow { name: string | null; member_count: number; university_domain: string | null }

const TARGET_LABEL: Record<string, string> = {
  confession: 'İtiraf', comment: 'Yorum', user: 'Kullanıcı', note: 'Not',
}
const APPEAL_TYPE_LABEL: Record<string, string> = {
  sanction: 'Yaptırım', content_removal: 'İçerik Kaldırma', account_ban: 'Hesap Banı',
}
const QUEUE_DOMAIN_LABEL: Record<string, string> = {
  moderation: 'Moderasyon', event_submissions: 'Etkinlik', story_placements: 'Story',
  support_tickets: 'Destek', fraud_review: 'Fraud',
}
const SANCTION_LABEL: Record<string, string> = {
  warning: 'Uyarı', temp_ban: 'Geçici Ban', permanent_ban: 'Kalıcı Ban',
}
const AUDIT_ACTION_LABEL: Record<string, string> = {
  hide: 'gizledi', publish: 'yayınladı', review: 'incelendi işaretledi', dismiss: 'reddetti',
  activate: 'aktifleştirdi', deactivate: 'pasifleştirdi', approve: 'onayladı', reject: 'reddetti',
  accept: 'kabul etti', ban: 'kalıcı yasakladı', temp_ban: 'geçici yasakladı', unban: 'yasağı kaldırdı',
  enable: 'kuralı açtı', disable: 'kuralı kapattı',
}
const ENTITY_LABEL: Record<string, string> = {
  confessions: 'itiraf', confession_comments: 'yorum', notes: 'not', reports: 'şikayet',
  communities: 'topluluk', event_submissions: 'etkinlik başvurusu', community_requests: 'topluluk başvurusu',
  moderation_appeals: 'itiraz', moderation_word_rules: 'kelime kuralı', profiles: 'kullanıcı',
}

/** Run a query; on failure log and return an empty row set so one bad query
 * never breaks the whole dashboard. */
async function safe<T extends QueryResultRow>(label: string, sql: string): Promise<T[]> {
  try {
    return (await pool.query<T>(sql)).rows
  } catch (err) {
    // eslint-disable-next-line no-console
    console.error(`dashboard query "${label}" failed:`, err)
    return []
  }
}

export async function dashboardHandler(): Promise<DashboardPayload> {
  const [
    kpiRows, queueRows, flaggedRows, appealRows, opsRows,
    reasonRows, targetRows, sanctionRows, trendRows, activityRows,
    scanRows, termRows, riskyRows, auditRows, uniRows, commRows,
  ] = await Promise.all([
    safe<KpiRow>('kpis', SQL_KPIS),
    safe<QueueRow>('queue', SQL_QUEUE),
    safe<FlaggedRow>('flagged', SQL_FLAGGED),
    safe<AppealRow>('appeals', SQL_APPEALS),
    safe<OpsRow>('ops', SQL_OPS),
    safe<ReasonRow>('reports_by_reason', SQL_REPORTS_BY_REASON),
    safe<TargetRow>('reports_by_target', SQL_REPORTS_BY_TARGET),
    safe<SanctionRow>('sanctions', SQL_SANCTIONS),
    safe<TrendRow>('trend', SQL_TREND),
    safe<ActivityRow>('activity', SQL_ACTIVITY),
    safe<ScanRow>('scan_today', SQL_SCAN_TODAY),
    safe<TermRow>('scan_terms', SQL_SCAN_TERMS),
    safe<RiskyRow>('risky_users', SQL_RISKY_USERS),
    safe<AuditRow>('recent_audit', SQL_RECENT_AUDIT),
    safe<UniRow>('top_unis', SQL_TOP_UNIS),
    safe<CommRow>('top_communities', SQL_TOP_COMMUNITIES),
  ])

  const k = kpiRows[0]
  const signupsToday = n(k?.signups_today)
  const signupsYday = n(k?.signups_yesterday)
  const confToday = n(k?.confessions_today)
  const confYday = n(k?.confessions_yesterday)

  const kpis: Kpi[] = [
    { key: 'pending_reports', label: 'Açık Şikayet', value: n(k?.pending_reports), delta: null, href: listHref('reports', 'status', 'pending'), icon: 'Flag', tone: attentionTone(n(k?.pending_reports), 1, 10) },
    { key: 'pending_appeals', label: 'Bekleyen İtiraz', value: n(k?.pending_appeals), delta: null, href: listHref('moderation_appeals', 'status', 'pending'), icon: 'Inbox', tone: attentionTone(n(k?.pending_appeals), 1, 5) },
    { key: 'needs_review', label: 'İnceleme Bekleyen', value: n(k?.needs_review), delta: null, href: listHref('confessions', 'moderation_status', 'needs_review'), icon: 'Search', tone: attentionTone(n(k?.needs_review), 1, 10) },
    { key: 'flagged_confessions', label: 'İşaretli İtiraf', value: n(k?.flagged_confessions), delta: null, href: listHref('confessions', 'is_flagged', 'true'), icon: 'AlertTriangle', tone: attentionTone(n(k?.flagged_confessions), 1, 10) },
    { key: 'flagged_comments', label: 'İşaretli Yorum', value: n(k?.flagged_comments), delta: null, href: listHref('confession_comments', 'is_flagged', 'true'), icon: 'MessageSquare', tone: attentionTone(n(k?.flagged_comments), 1, 10) },
    { key: 'flagged_notes', label: 'İşaretli Not', value: n(k?.flagged_notes), delta: null, href: listHref('notes', 'is_flagged', 'true'), icon: 'BookOpen', tone: attentionTone(n(k?.flagged_notes), 1, 10) },
    { key: 'sla_breaches', label: 'SLA İhlali', value: n(k?.sla_breaches), delta: null, href: listHref('ops_queue_items'), icon: 'Clock', tone: attentionTone(n(k?.sla_breaches), 1, 5) },
    { key: 'pending_events', label: 'Bekleyen Etkinlik', value: n(k?.pending_events), delta: null, href: listHref('event_submissions', 'status', 'pending'), icon: 'Calendar', tone: attentionTone(n(k?.pending_events), 1, 10) },
    { key: 'pending_community_requests', label: 'Topluluk Başvurusu', value: n(k?.pending_community_requests), delta: null, href: listHref('community_requests', 'status', 'pending'), icon: 'UserPlus', tone: attentionTone(n(k?.pending_community_requests), 1, 10) },
    { key: 'active_sanctions', label: 'Aktif Yaptırım', value: n(k?.active_sanctions), delta: null, href: listHref('user_sanctions', 'is_active', 'true'), icon: 'Slash', tone: 'ok' },
    { key: 'active_sessions', label: 'Aktif Seans', value: n(k?.active_sessions), delta: null, href: listHref('study_sessions'), icon: 'Activity', tone: 'ok' },
    { key: 'signups_today', label: 'Bugünkü Kayıt', value: signupsToday, delta: signupsToday - signupsYday, href: listHref('profiles'), icon: 'Users', tone: 'ok' },
    { key: 'confessions_today', label: 'Bugünkü İtiraf', value: confToday, delta: confToday - confYday, href: listHref('confessions'), icon: 'MessageSquare', tone: 'ok' },
    { key: 'total_users', label: 'Toplam Kullanıcı', value: n(k?.total_users), delta: null, href: listHref('profiles'), icon: 'Users', tone: 'ok' },
  ]

  const reportQueue: QueueItem[] = queueRows.map((r) => {
    const t = r.target_type ?? ''
    return {
      id: String(r.id),
      targetType: t,
      targetLabel: TARGET_LABEL[t] ?? (t || 'Bilinmiyor'),
      reason: r.reason ?? '—',
      rel: relTr(r.created_at),
      href: showHref('reports', r.id),
    }
  })

  const FLAGGED_TABLE: Record<string, string> = {
    confession: 'confessions', comment: 'confession_comments', note: 'notes',
  }
  const flaggedContent: FlaggedItem[] = flaggedRows.map((r) => ({
    id: r.id,
    source: r.source,
    sourceLabel: TARGET_LABEL[r.source] ?? r.source,
    flagKind: r.flag_kind === 'auto' ? 'auto' : 'user',
    label: r.label,
    snippet: r.snippet ?? '',
    university: r.university,
    rel: relTr(r.created_at),
    href: showHref(FLAGGED_TABLE[r.source] ?? 'confessions', r.id),
  }))

  const appealQueue: AppealItem[] = appealRows.map((r) => ({
    id: String(r.id),
    typeLabel: APPEAL_TYPE_LABEL[r.appeal_type ?? ''] ?? (r.appeal_type || 'İtiraz'),
    reason: r.reason ?? '—',
    rel: relTr(r.created_at),
    href: showHref('moderation_appeals', r.id),
  }))

  const opsQueue: OpsItem[] = opsRows.map((r) => ({
    id: String(r.id),
    domainLabel: QUEUE_DOMAIN_LABEL[r.queue_domain ?? ''] ?? (r.queue_domain || '—'),
    title: r.title ?? '—',
    severity: r.severity ?? 'P3',
    state: r.state ?? 'open',
    owned: r.owner_id != null,
    due: dueTr(r.due_at),
    rel: relTr(r.created_at),
    href: showHref('ops_queue_items', r.id),
  }))

  const reportsByReason: BreakdownRow[] = reasonRows.map((r) => ({
    key: r.reason ?? '—',
    label: r.reason ?? '—',
    count: n(r.nn),
    href: null,
  }))

  const reportsByTarget: BreakdownRow[] = targetRows.map((r) => ({
    key: r.target_type ?? '—',
    label: TARGET_LABEL[r.target_type ?? ''] ?? (r.target_type || '—'),
    count: n(r.nn),
    href: r.target_type ? listHref('reports', 'target_type', r.target_type) : null,
  }))

  const activeSanctions: BreakdownRow[] = sanctionRows.map((r) => ({
    key: r.sanction_type ?? '—',
    label: SANCTION_LABEL[r.sanction_type ?? ''] ?? (r.sanction_type || '—'),
    count: n(r.nn),
    href: r.sanction_type ? listHref('user_sanctions', 'sanction_type', r.sanction_type) : null,
  }))

  const signupTrend: TrendPoint[] = trendRows.map((r) => ({ label: fmtDay(r.day), value: n(r.signups) }))
  const activityTrend: ActivityPoint[] = activityRows.map((r) => ({
    label: fmtDay(r.day), content: n(r.content), reports: n(r.reports),
  }))

  const scan = scanRows[0]
  const scAllow = n(scan?.allow)
  const scReview = n(scan?.review)
  const scBlock = n(scan?.block)
  const scTotal = scAllow + scReview + scBlock
  const scanSummary: ScanSummary = {
    allow: scAllow,
    review: scReview,
    block: scBlock,
    blockRate: scTotal > 0 ? Math.round((scBlock / scTotal) * 100) : 0,
    topTerms: termRows.map((t) => ({ term: t.term, count: n(t.nn) })),
  }

  const riskyUsers: RiskyUser[] = riskyRows.map((r) => ({
    id: r.id,
    username: r.username ?? '(bilinmiyor)',
    count: n(r.nn),
    href: showHref('profiles', r.id),
  }))

  const recentActions: AuditItem[] = auditRows.map((r) => ({
    actor: r.actor_email ?? 'sistem',
    actionLabel: AUDIT_ACTION_LABEL[r.action ?? ''] ?? (r.action || ''),
    entityLabel: ENTITY_LABEL[r.entity_type ?? ''] ?? (r.entity_type || ''),
    reason: r.reason,
    rel: relTr(r.created_at),
  }))

  const topUniversities: TopUniversity[] = uniRows.map((r) => ({
    domain: r.domain,
    name: r.name ?? r.domain,
    total: n(r.total),
    href: listHref('confessions', 'university_domain', r.domain),
  }))

  const topCommunities: TopCommunity[] = commRows.map((r) => ({
    name: r.name ?? '—',
    members: n(r.member_count),
    university: r.university_domain,
  }))

  return {
    kpis,
    reportQueue,
    flaggedContent,
    appealQueue,
    opsQueue,
    reportsByReason,
    reportsByTarget,
    activeSanctions,
    signupTrend,
    activityTrend,
    topUniversities,
    topCommunities,
    riskyUsers,
    scanSummary,
    recentActions,
    generatedAt: new Date().toISOString(),
  }
}

// r.day is a pg `::date` (UTC midnight); use getUTC* so the label is the correct
// Istanbul calendar day. Do NOT switch to local getDate/getMonth — a UTC-timezone
// host would then render the previous day.
function fmtDay(day: string): string {
  const d = new Date(day)
  const dd = String(d.getUTCDate()).padStart(2, '0')
  const mm = String(d.getUTCMonth() + 1).padStart(2, '0')
  return `${dd}.${mm}`
}
