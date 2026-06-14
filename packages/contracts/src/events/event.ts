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

// ─── Stories + logs + city-context (Wave E) ──────────────────────────────────

/**
 * GET /events/stories — one active story slot + its nested event (same `city_events`
 * nesting as the feed row), so the RN `mapEventStorySlotRows` consumes both paths.
 */
export const eventStorySlotRowSchema = z.object({
  id: z.string(),
  event_id: z.string(),
  slot_index: z.number().int(),
  title_override: z.string().nullable(),
  starts_at: z.string(),
  ends_at: z.string(),
  city_events: eventFeedRowSchema,
})
export type EventStorySlotRow = z.infer<typeof eventStorySlotRowSchema>

/** POST /events/logs — campaign analytics event (viewer fields from the principal). */
export const logEventBodySchema = z.object({
  event_id: z.string().uuid().nullable().default(null),
  story_slot_id: z.string().uuid().nullable().default(null),
  event_type: z.enum(['story_impression', 'story_tap', 'detail_open', 'cta_click', 'map_open']),
  source: z.enum(['mobile', 'admin', 'landing']).default('mobile'),
})
export type LogEventBody = z.infer<typeof logEventBodySchema>

/** GET /events/city-context — the caller's resolved city (from university_domain). */
export const viewerCitySchema = z.object({ id: z.string(), name: z.string() })
export type ViewerCity = z.infer<typeof viewerCitySchema>
