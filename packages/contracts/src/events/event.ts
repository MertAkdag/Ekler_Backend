import { z } from 'zod'
import { MAX_PAGE_SIZE } from '../pagination'

/**
 * City events feed — port of the RN direct `city_events` read (no RPC existed).
 * Events are CITY-scoped (not university): the city is resolved from the caller's
 * university_domain via resolve_city_id_for_university_domain — identical to the RLS
 * helper current_user_event_city_id() the Supabase path relied on. The time window
 * (today/week/month) is computed server-side in Europe/Istanbul. Single capped load.
 */
export const eventTimeFilterSchema = z.enum(['today', 'week', 'month'])
export type EventTimeFilter = z.infer<typeof eventTimeFilterSchema>

export const eventFeedQuerySchema = z.object({
  category: z.string().optional(), // a category key; 'all'/absent → no category filter
  time_filter: eventTimeFilterSchema.default('week'),
  limit: z.coerce.number().int().min(1).max(MAX_PAGE_SIZE).default(40),
})
export type EventFeedQuery = z.infer<typeof eventFeedQuerySchema>

/**
 * One feed row — the columns the RN selects, plus the nested `cities: { name }`
 * relation (so the existing mapCityEventRow consumes both paths identically).
 */
export const eventFeedRowSchema = z.object({
  id: z.string(),
  partner_id: z.string().nullable(),
  title: z.string(),
  description: z.string().nullable(),
  cover_url: z.string().nullable(),
  starts_at: z.string(),
  ends_at: z.string().nullable(),
  venue_name: z.string(),
  venue_address: z.string().nullable(),
  city_id: z.string(),
  category: z.string(),
  ticket_url: z.string().nullable(),
  price_label: z.string().nullable(),
  is_sponsored: z.boolean(),
  sponsorship_tier: z.string().nullable(),
  status: z.string(),
  organizer_name: z.string().nullable(),
  organizer_instagram: z.string().nullable(),
  organizer_url: z.string().nullable(),
  cities: z.object({ name: z.string().nullable() }).nullable(),
})
export type EventFeedRow = z.infer<typeof eventFeedRowSchema>
