import { Inject, Injectable } from '@nestjs/common'
import { sql } from 'drizzle-orm'
import type { EventFeedQuery, EventFeedRow } from '@ekler/contracts'
import { DRIZZLE, type Db } from '../../db/drizzle.module'
import { ScopedRepository } from '../../db/scoped/scoped-repository'
import type { AuthPrincipal } from '../../core/cls/cls-store'

/**
 * City events feed — port of the RN direct `city_events` read.
 *
 * city_events is NOT a university-scoped table; it is CITY-scoped. The Supabase path
 * leaned on RLS (current_user_event_city_id()) for that scope. We resolve the city
 * EXPLICITLY from the caller's university_domain via the same DB resolver, then filter
 * `city_id` ourselves (the anti-K-1 control here is the city, not the university).
 *
 * Raw SQL (city_events isn't in the ScopedRepository brand set): mirrors the RN
 * select — visible statuses, the time-window overlap, optional category, sponsored-first
 * ordering — with the window computed in Europe/Istanbul (the app's market).
 */
@Injectable()
export class EventsService {
  constructor(
    @Inject(DRIZZLE) private readonly db: Db,
    private readonly scope: ScopedRepository,
  ) {}

  async feed(q: EventFeedQuery, _user: AuthPrincipal): Promise<EventFeedRow[]> {
    const domain = this.scope.domain() // fail-closed; also the city-resolution input

    const cityRes = (await this.db.execute(
      sql`select public.resolve_city_id_for_university_domain(${domain}) as cid`,
    )) as unknown as { rows: Array<{ cid: string | null }> }
    const cityId = cityRes.rows[0]?.cid
    if (!cityId) return []

    const windowInterval =
      q.time_filter === 'today'
        ? sql`interval '1 day'`
        : q.time_filter === 'month'
          ? sql`interval '1 month'`
          : sql`interval '7 days'`
    const categoryCond =
      q.category && q.category !== 'all' ? sql`and e.category = ${q.category}` : sql``

    const res = (await this.db.execute(sql`
      with win as (
        select (date_trunc('day', now() at time zone 'Europe/Istanbul') at time zone 'Europe/Istanbul') as wstart
      )
      select
        e.id, e.partner_id, e.title, e.description, e.cover_url, e.starts_at, e.ends_at,
        e.venue_name, e.venue_address, e.city_id, e.category, e.ticket_url, e.price_label,
        e.is_sponsored, e.sponsorship_tier, e.status,
        e.organizer_name, e.organizer_instagram, e.organizer_url,
        ci.name as city_name
      from public.city_events e
      left join public.cities ci on ci.id = e.city_id
      cross join win
      where e.city_id = ${cityId}
        and e.status in ('approved', 'scheduled', 'live')
        and e.starts_at < (win.wstart + ${windowInterval})
        and ((e.ends_at is null and e.starts_at >= win.wstart) or e.ends_at >= win.wstart)
        ${categoryCond}
      order by e.is_sponsored desc, e.starts_at asc
      limit ${q.limit}
    `)) as unknown as { rows: Array<Record<string, unknown> & { city_name: string | null }> }

    // Re-nest the city name so the RN mapper (which reads row.cities.name) is unchanged.
    return res.rows.map(({ city_name, ...row }) => ({
      ...row,
      cities: { name: city_name },
    })) as EventFeedRow[]
  }
}
