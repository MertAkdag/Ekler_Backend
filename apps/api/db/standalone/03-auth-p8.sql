-- ── P8 own-auth: email OTP + EdDSA sessions ─────────────────────────────────
-- Only the Node service DB role reads/writes these. NO RLS, NO grants to
-- authenticated/anon (unlike the RLS content tables). auth.users stays the
-- shell from 01-bootstrap.sql; we only add a case-insensitive unique on email
-- so the find-or-create upsert is race-safe.

-- 0) Make auth.users + profiles email unique (case-insensitive). The shell
--    auth.users had only its PK; profiles had a case-SENSITIVE unique. All writes
--    lowercase, but match both constraints so one account == one email regardless.
create unique index if not exists auth_users_email_lower_uk
  on auth.users (lower(email));
create unique index if not exists profiles_email_lower_uk
  on public.profiles (lower(email));

-- 1) OTP codes ───────────────────────────────────────────────────────────────
create table if not exists public.auth_otp_codes (
  id            uuid        primary key default gen_random_uuid(),
  email         text        not null,            -- lowercased+trimmed; NOT FK (user may not exist yet)
  code_hash     bytea       not null,            -- HMAC-SHA256(code, AUTH_OTP_PEPPER), raw 32 bytes
  expires_at    timestamptz not null,            -- created_at + 10 min
  attempts      integer     not null default 0,
  max_attempts  integer     not null default 5,
  consumed_at   timestamptz,                     -- set on success OR lockout (single-use)
  requester_ip  inet,
  user_agent    text,
  created_at    timestamptz not null default now(),
  constraint auth_otp_codes_email_lower_chk check (email = lower(email))
);

-- At most ONE live (unconsumed) code per email. We also supersede on request.
create unique index if not exists auth_otp_codes_one_active_per_email
  on public.auth_otp_codes (email)
  where consumed_at is null;

-- Hot path: "the active code for this email".
create index if not exists auth_otp_codes_email_active
  on public.auth_otp_codes (email, expires_at)
  where consumed_at is null;

-- Per-email request rate-limit counting (count over created_at) + janitor.
create index if not exists auth_otp_codes_email_created
  on public.auth_otp_codes (email, created_at);
create index if not exists auth_otp_codes_created
  on public.auth_otp_codes (created_at);

-- 2) Refresh sessions ─────────────────────────────────────────────────────────
create table if not exists public.auth_sessions (
  id                  uuid        primary key default gen_random_uuid(),
  user_id             uuid        not null references auth.users(id) on delete cascade,
  refresh_token_hash  bytea       not null,      -- sha256(opaque token), raw 32 bytes
  family_id           uuid        not null,      -- stable across a rotation chain
  parent_id           uuid        references public.auth_sessions(id) on delete set null,
  issued_at           timestamptz not null default now(),
  expires_at          timestamptz not null,      -- per-token TTL (issued_at + AUTH_REFRESH_TTL, 30d)
  family_expires_at   timestamptz not null,      -- absolute family cap (first issue + AUTH_FAMILY_TTL, 90d); carried across rotations
  revoked_at          timestamptz,
  revoked_reason      text,                       -- 'rotated' | 'reuse_detected' | 'logout' | 'expired'
  user_agent          text,
  ip                  inet,
  created_at          timestamptz not null default now(),
  constraint auth_sessions_refresh_hash_uk unique (refresh_token_hash)
);

create index if not exists auth_sessions_user        on public.auth_sessions (user_id);
create index if not exists auth_sessions_family      on public.auth_sessions (family_id);
create index if not exists auth_sessions_user_active on public.auth_sessions (user_id)
  where revoked_at is null;
create index if not exists auth_sessions_expires     on public.auth_sessions (expires_at);

-- 3) Domain resolver: canonical university_domain from an email domain
--    (canonical domain or alias → parent domain; NULL if unknown).
create or replace function public.resolve_university_domain(p_email_domain text)
returns text
language sql
stable
as $$
  select u.domain
  from public.universities u
  where u.domain = lower(trim(p_email_domain))
  union all
  select u.domain
  from public.university_domain_aliases a
  join public.universities u on u.id = a.university_id
  where a.alias_domain = lower(trim(p_email_domain))
  limit 1
$$;
