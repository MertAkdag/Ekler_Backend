import { pool } from './db.js'

export interface DashboardStats {
  pending_reports: number
  flagged_confessions: number
  flagged_comments: number
  flagged_notes: number
  signups_today: number
  total_users: number
  active_sessions: number
  pending_events: number
}

/**
 * Dashboard data handler — one round-trip of operational counts the moderator
 * cares about first. Returned to the custom Dashboard component via getDashboard().
 */
export async function dashboardHandler(): Promise<{ stats: DashboardStats }> {
  const { rows } = await pool.query<Record<keyof DashboardStats, string>>(`
    select
      (select count(*) from public.reports where status = 'pending')                     as pending_reports,
      (select count(*) from public.confessions where is_flagged)                          as flagged_confessions,
      (select count(*) from public.confession_comments where is_flagged)                  as flagged_comments,
      (select count(*) from public.notes where is_flagged)                                as flagged_notes,
      (select count(*) from public.profiles where created_at >= date_trunc('day', now())) as signups_today,
      (select count(*) from public.profiles)                                              as total_users,
      (select count(*) from public.study_sessions where status in ('active', 'full'))     as active_sessions,
      (select count(*) from public.event_submissions where status = 'pending')            as pending_events
  `)

  const r = rows[0]
  const n = (v: string | undefined): number => Number(v ?? 0)
  return {
    stats: {
      pending_reports: n(r?.pending_reports),
      flagged_confessions: n(r?.flagged_confessions),
      flagged_comments: n(r?.flagged_comments),
      flagged_notes: n(r?.flagged_notes),
      signups_today: n(r?.signups_today),
      total_users: n(r?.total_users),
      active_sessions: n(r?.active_sessions),
      pending_events: n(r?.pending_events),
    },
  }
}
