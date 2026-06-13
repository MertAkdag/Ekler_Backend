import { pool } from './db.js'

/**
 * Moderation-cockpit dashboard payload. One handler, six parallel queries.
 * Day boundaries use Europe/Istanbul so "today/yesterday/14d" match Turkey
 * regardless of the pool's session timezone (no pool.on('connect') needed).
 *
 * hrefs are built HERE (server) using only URL formats verified reliable:
 *  - filtered list:  /admin/resources/<table>/actions/list?filters.<col>=<val>
 *  - record show:    /admin/resources/<table>/records/<id>/show
 * Boolean filters (is_flagged=true) and exact status filters are reliable.
 * DATE "today" filters are NOT, so signups_today/confessions_today link to the
 * default-sorted list (created_at desc), and active_sessions (2 status values)
 * links to the unfiltered sorted list. The KPI counts themselves are exact.
 */

const ROOT = '/admin'

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
export interface TrendPoint {
  label: string
  value: number
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
  signupTrend: TrendPoint[]
  topUniversities: TopUniversity[]
  topCommunities: TopCommunity[]
  generatedAt: string
}

// ---- SQL (parameterless; counts come back as strings) -------------------

const SQL_KPIS = `
  with b as (
    select
      date_trunc('day', now() at time zone 'Europe/Istanbul')                    as today_start,
      date_trunc('day', now() at time zone 'Europe/Istanbul') - interval '1 day' as yday_start
  )
  select
    (select count(*) from public.reports             where status = 'pending')              as pending_reports,
    (select count(*) from public.confessions         where is_flagged = true)               as flagged_confessions,
    (select count(*) from public.confession_comments where is_flagged = true)               as flagged_comments,
    (select count(*) from public.notes               where is_flagged = true)               as flagged_notes,
    (select count(*) from public.event_submissions   where status = 'pending')              as pending_events,
    (select count(*) from public.study_sessions      where status in ('active','full'))     as active_sessions,
    (select count(*) from public.profiles)                                                  as total_users,
    (select count(*) from public.profiles, b    where (created_at at time zone 'Europe/Istanbul') >= b.today_start)                                                              as signups_today,
    (select count(*) from public.profiles, b    where (created_at at time zone 'Europe/Istanbul') >= b.yday_start and (created_at at time zone 'Europe/Istanbul') < b.today_start) as signups_yesterday,
    (select count(*) from public.confessions, b where (created_at at time zone 'Europe/Istanbul') >= b.today_start)                                                              as confessions_today,
    (select count(*) from public.confessions, b where (created_at at time zone 'Europe/Istanbul') >= b.yday_start and (created_at at time zone 'Europe/Istanbul') < b.today_start) as confessions_yesterday
`

const SQL_QUEUE = `
  select id, target_type, reason, created_at
  from public.reports
  where status = 'pending'
  order by created_at desc
  limit 8
`

// Surfaces BOTH user-flagged content (is_flagged, report-driven) AND the auto
// moderator's review queue (moderation_status='needs_review') — the latter was
// previously invisible. flag_kind distinguishes the two so the moderator knows
// whether a human reported it or the engine caught it (and why, via label).
// Notes are included (the KPI counted them but the list omitted them).
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

const SQL_TREND = `
  with days as (
    select generate_series(
      date_trunc('day', now() at time zone 'Europe/Istanbul') - interval '13 days',
      date_trunc('day', now() at time zone 'Europe/Istanbul'),
      interval '1 day'
    ) as day
  ),
  counts as (
    select date_trunc('day', created_at at time zone 'Europe/Istanbul') as day, count(*) as nn
    from public.profiles
    where (created_at at time zone 'Europe/Istanbul') >= date_trunc('day', now() at time zone 'Europe/Istanbul') - interval '13 days'
    group by 1
  )
  select d.day::date as day, coalesce(c.nn, 0)::int as signups
  from days d
  left join counts c on c.day = d.day
  order by d.day asc
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
  pending_reports: string; flagged_confessions: string; flagged_comments: string
  flagged_notes: string; pending_events: string; active_sessions: string
  total_users: string; signups_today: string; signups_yesterday: string
  confessions_today: string; confessions_yesterday: string
}
interface QueueRow { id: string | number; target_type: string | null; reason: string | null; created_at: string }
interface FlaggedRow { id: string; source: string; snippet: string | null; university: string | null; flag_kind: string; label: string | null; created_at: string }
interface TrendRow { day: string; signups: number }
interface UniRow { domain: string; name: string | null; total: number }
interface CommRow { name: string | null; member_count: number; university_domain: string | null }

const TARGET_LABEL: Record<string, string> = {
  confession: 'İtiraf', comment: 'Yorum', user: 'Kullanıcı', note: 'Not',
}

export async function dashboardHandler(): Promise<DashboardPayload> {
  const [kpiRes, queueRes, flaggedRes, trendRes, uniRes, commRes] = await Promise.all([
    pool.query<KpiRow>(SQL_KPIS),
    pool.query<QueueRow>(SQL_QUEUE),
    pool.query<FlaggedRow>(SQL_FLAGGED),
    pool.query<TrendRow>(SQL_TREND),
    pool.query<UniRow>(SQL_TOP_UNIS),
    pool.query<CommRow>(SQL_TOP_COMMUNITIES),
  ])

  const k = kpiRes.rows[0]
  const pendingReports = n(k?.pending_reports)
  const flConf = n(k?.flagged_confessions)
  const flComm = n(k?.flagged_comments)
  const flNotes = n(k?.flagged_notes)
  const pendEvents = n(k?.pending_events)
  const activeSessions = n(k?.active_sessions)
  const totalUsers = n(k?.total_users)
  const signupsToday = n(k?.signups_today)
  const signupsYday = n(k?.signups_yesterday)
  const confToday = n(k?.confessions_today)
  const confYday = n(k?.confessions_yesterday)

  const kpis: Kpi[] = [
    { key: 'pending_reports', label: 'Açık Şikayet', value: pendingReports, delta: null, href: listHref('reports', 'status', 'pending'), icon: 'Flag', tone: attentionTone(pendingReports, 1, 10) },
    { key: 'flagged_confessions', label: 'İşaretli İtiraf', value: flConf, delta: null, href: listHref('confessions', 'is_flagged', 'true'), icon: 'AlertTriangle', tone: attentionTone(flConf, 1, 10) },
    { key: 'flagged_comments', label: 'İşaretli Yorum', value: flComm, delta: null, href: listHref('confession_comments', 'is_flagged', 'true'), icon: 'MessageSquare', tone: attentionTone(flComm, 1, 10) },
    { key: 'flagged_notes', label: 'İşaretli Not', value: flNotes, delta: null, href: listHref('notes', 'is_flagged', 'true'), icon: 'BookOpen', tone: attentionTone(flNotes, 1, 10) },
    { key: 'pending_events', label: 'Bekleyen Etkinlik', value: pendEvents, delta: null, href: listHref('event_submissions', 'status', 'pending'), icon: 'Calendar', tone: attentionTone(pendEvents, 1, 10) },
    { key: 'active_sessions', label: 'Aktif Seans', value: activeSessions, delta: null, href: listHref('study_sessions'), icon: 'Activity', tone: 'ok' },
    { key: 'signups_today', label: 'Bugünkü Kayıt', value: signupsToday, delta: signupsToday - signupsYday, href: listHref('profiles'), icon: 'Users', tone: 'ok' },
    { key: 'confessions_today', label: 'Bugünkü İtiraf', value: confToday, delta: confToday - confYday, href: listHref('confessions'), icon: 'MessageSquare', tone: 'ok' },
    { key: 'total_users', label: 'Toplam Kullanıcı', value: totalUsers, delta: null, href: listHref('profiles'), icon: 'Users', tone: 'ok' },
  ]

  const reportQueue: QueueItem[] = queueRes.rows.map((r) => {
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
  const flaggedContent: FlaggedItem[] = flaggedRes.rows.map((r) => ({
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

  const signupTrend: TrendPoint[] = trendRes.rows.map((r) => {
    // r.day is a pg `::date` (UTC midnight); use getUTC* so the label is the
    // correct Istanbul calendar day. Do NOT switch to local getDate/getMonth —
    // a UTC-timezone host would then render the previous day.
    const d = new Date(r.day)
    const dd = String(d.getUTCDate()).padStart(2, '0')
    const mm = String(d.getUTCMonth() + 1).padStart(2, '0')
    return { label: `${dd}.${mm}`, value: n(r.signups) }
  })

  const topUniversities: TopUniversity[] = uniRes.rows.map((r) => ({
    domain: r.domain,
    name: r.name ?? r.domain,
    total: n(r.total),
    href: listHref('confessions', 'university_domain', r.domain),
  }))

  const topCommunities: TopCommunity[] = commRes.rows.map((r) => ({
    name: r.name ?? '—',
    members: n(r.member_count),
    university: r.university_domain,
  }))

  return {
    kpis,
    reportQueue,
    flaggedContent,
    signupTrend,
    topUniversities,
    topCommunities,
    generatedAt: new Date().toISOString(),
  }
}
