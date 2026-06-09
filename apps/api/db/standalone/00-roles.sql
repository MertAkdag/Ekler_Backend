-- Cluster roles the Supabase schema dump references (ownership / GRANTs / RLS TO ...).
-- Run once per cluster (roles are cluster-global, not per-database).
do $$ begin
  if not exists (select from pg_roles where rolname='postgres')      then create role postgres superuser login;   end if;
  if not exists (select from pg_roles where rolname='anon')          then create role anon nologin;               end if;
  if not exists (select from pg_roles where rolname='authenticated') then create role authenticated nologin;      end if;
  if not exists (select from pg_roles where rolname='service_role')  then create role service_role nologin bypassrls; end if;
  if not exists (select from pg_roles where rolname='authenticator') then create role authenticator noinherit login; end if;
  if not exists (select from pg_roles where rolname='supabase_admin') then create role supabase_admin superuser;  end if;
end $$;
