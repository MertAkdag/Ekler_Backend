# @ekler/worker

Background processing (Phase 5+). Single image with `apps/api` but run as the Fly
`worker` process group:

- **BullMQ consumers** — `gdpr` (delete-user cascade, export→R2), `push` (Expo
  batches), `storage-maint`.
- **@nestjs/schedule cron** — telemetry/campaign-log purges, monthly partition
  roller (`app_telemetry_events` + `moderation_scan_logs`), MV refresh, presence
  reaper.

Single maintenance node guarded by `pg_try_advisory_lock` (no leader election
across replicas). Placeholder until Phase 5.
