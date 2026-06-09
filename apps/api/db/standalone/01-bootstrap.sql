-- ── P7 bootstrap: make the Supabase public-schema dump applyable on a vanilla PG17 ──
create schema if not exists extensions;
create extension if not exists pg_trgm schema extensions;
create extension if not exists btree_gist;

-- Shell auth schema: public has 42 FKs to auth.users + 160 auth.uid()/57 auth.role()
-- calls. Own OTP auth (P8) replaces this; for now it's an empty shell so the schema
-- and the kept-in-DB functions load + run. (auth.uid reads the txn-local jwt claims
-- that the Node moderation RPCs set, exactly like Supabase.)
create schema if not exists auth;
create table if not exists auth.users (
  id uuid primary key default gen_random_uuid(),
  email text,
  encrypted_password text,
  email_confirmed_at timestamptz,
  phone text,
  raw_user_meta_data jsonb,
  raw_app_meta_data jsonb,
  is_super_admin boolean,
  banned_until timestamptz,
  deleted_at timestamptz,
  is_anonymous boolean default false,
  created_at timestamptz default now(),
  updated_at timestamptz default now()
);
create or replace function auth.uid() returns uuid language sql stable as $$
  select coalesce(
    nullif(current_setting('request.jwt.claim.sub', true), ''),
    (nullif(current_setting('request.jwt.claims', true), '')::jsonb ->> 'sub')
  )::uuid
$$;
create or replace function auth.role() returns text language sql stable as $$
  select coalesce(
    nullif(current_setting('request.jwt.claim.role', true), ''),
    (nullif(current_setting('request.jwt.claims', true), '')::jsonb ->> 'role')
  )
$$;
create or replace function auth.jwt() returns jsonb language sql stable as $$
  select coalesce(nullif(current_setting('request.jwt.claims', true), ''), '{}')::jsonb
$$;
grant usage on schema extensions, auth to postgres, authenticated, anon, service_role;
