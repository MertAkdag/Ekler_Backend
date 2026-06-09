import { pool } from './db.js'

/**
 * Drill-down "hub" pages: an overview grouped by a dimension (city / university),
 * each value showing per-resource counts that link into the matching filtered
 * resource list. Handlers build the count rows AND the filtered-list hrefs (keeping
 * the one fragile URL string in server code, off the blind React side).
 */

const ROOT = '/admin'

/**
 * Filtered-list URL. The `filters.` dot is literal (AdminJS parses the query with
 * qs allowDots); the value is encoded. NOTE: text columns (university_domain) are
 * filtered case-insensitively as a substring by @adminjs/sql, so the opened list is
 * a superset — the chip COUNT (computed below) is the exact figure. FK columns
 * (city_id) filter exactly.
 */
function listHref(resourceId: string, col: string, value: string): string {
  return `${ROOT}/resources/${resourceId}/actions/list?filters.${col}=${encodeURIComponent(value)}`
}

interface HubChip {
  label: string
  count: number
  href: string
}
interface HubRow {
  id: string
  label: string
  sublabel?: string
  chips: HubChip[]
}
export interface HubPayload {
  title: string
  rows: HubRow[]
}

const n = (v: string | undefined): number => Number(v ?? 0)

/**
 * University hub — group by universities.domain. Counts use the canonical domain
 * (NOT alias-resolved) so the chip count and the filtered list it links to scope
 * identically. Aliased content (university_domain_aliases) is unlikely at launch
 * (empty start, no data migration); if it appears, both count and link undercount
 * the same way — consistent, never misleading.
 */
export async function universitiesHubHandler(): Promise<HubPayload> {
  const { rows } = await pool.query<{
    domain: string
    name: string
    profiles: string
    confessions: string
    notes: string
    communities: string
    study_sessions: string
    courses: string
  }>(`
    select
      u.domain as domain,
      u.name   as name,
      (select count(*) from public.profiles       t where t.university_domain = u.domain) as profiles,
      (select count(*) from public.confessions    t where t.university_domain = u.domain) as confessions,
      (select count(*) from public.notes          t where t.university_domain = u.domain) as notes,
      (select count(*) from public.communities    t where t.university_domain = u.domain) as communities,
      (select count(*) from public.study_sessions t where t.university_domain = u.domain) as study_sessions,
      (select count(*) from public.courses        t where t.university_domain = u.domain) as courses
    from public.universities u
    order by u.name asc
    limit 500
  `)

  return {
    title: 'Üniversiteler — Genel Bakış',
    rows: rows.map((r) => ({
      id: r.domain,
      label: r.name,
      sublabel: r.domain,
      chips: [
        { label: 'Profiller', count: n(r.profiles), href: listHref('profiles', 'university_domain', r.domain) },
        { label: 'İtiraflar', count: n(r.confessions), href: listHref('confessions', 'university_domain', r.domain) },
        { label: 'Notlar', count: n(r.notes), href: listHref('notes', 'university_domain', r.domain) },
        { label: 'Topluluklar', count: n(r.communities), href: listHref('communities', 'university_domain', r.domain) },
        { label: 'Çalışma Oturumları', count: n(r.study_sessions), href: listHref('study_sessions', 'university_domain', r.domain) },
        { label: 'Dersler', count: n(r.courses), href: listHref('courses', 'university_domain', r.domain) },
      ],
    })),
  }
}

/** City hub — group by cities.id. city_id is a real FK → exact filter match. */
export async function citiesHubHandler(): Promise<HubPayload> {
  const { rows } = await pool.query<{
    id: string
    name: string
    city_events: string
    event_submissions: string
  }>(`
    select
      c.id   as id,
      c.name as name,
      (select count(*) from public.city_events       e where e.city_id = c.id) as city_events,
      (select count(*) from public.event_submissions s where s.city_id = c.id) as event_submissions
    from public.cities c
    order by c.name asc
    limit 500
  `)

  return {
    title: 'Şehirler — Genel Bakış',
    rows: rows.map((r) => ({
      id: r.id,
      label: r.name,
      chips: [
        { label: 'Şehir Etkinlikleri', count: n(r.city_events), href: listHref('city_events', 'city_id', r.id) },
        { label: 'Etkinlik Başvuruları', count: n(r.event_submissions), href: listHref('event_submissions', 'city_id', r.id) },
      ],
    })),
  }
}
