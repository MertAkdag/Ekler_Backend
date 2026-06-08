# @ekler/admin

AdminJS v7 admin panel (Phase 5+). **Runs as a SEPARATE Express process** —
AdminJS is ESM-only and coupled to Express/`express-session`, so it will not
mount on Fastify. Shares the Drizzle/pg connection and the existing `admin_*`
RBAC tables (roles, permissions, audit logs, ops queue).

~17 resources: User, Confession, Note, StudySession, Community, Reports,
ModerationAppeal, EventSubmission, CityEvent, EventStorySlot, RevenueDeal,
PushCampaign, ModerationWordRule, LandingPageSection, AdminFeatureFlag,
AdminAuditLog (read-only), OpsQueueItem. Placeholder until Phase 5.
