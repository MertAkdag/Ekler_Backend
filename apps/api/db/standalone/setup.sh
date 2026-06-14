#!/usr/bin/env bash
# P7 — recreate the STANDALONE Postgres (our own DB, zero Supabase).
#
# Builds a vanilla PostgreSQL 17 database that runs the full app schema:
#   00-roles.sql     cluster roles the dump references (run once per cluster)
#   01-bootstrap.sql extensions (pg_trgm in `extensions`, btree_gist) + shell `auth`
#                    schema (auth.users + auth.uid()/role()/jwt()) so the 34 FKs and
#                    160+ auth.uid() calls resolve. Own OTP auth (P8) replaces this.
#   02-schema.sql    pg_dump --schema-only --schema=public of Supabase (DDL only, NO
#                    data — empty start). 62 tables, 243 functions, 15 triggers, the
#                    moderation engine, 124 RLS policies (inert: Node connects as a
#                    superuser/bypassrls role and enforces tenancy itself).
#   03-auth-p8.sql   own-auth (P8) tables: auth_otp_codes + auth_sessions + the
#                    case-insensitive email uniques + resolve_university_domain().
#                    REQUIRED — without it /v1/auth/* 500s against a fresh DB.
#   04-catalog-and-blocks.sql
#                    objects the 02 dump missed: course_suggestions + suggest_course
#                    (crowdsourced catalog) and blocked_users + is_blocked_between
#                    (UGC-safety). REQUIRED for /v1/courses/suggest + /v1/me/blocks.
#
# Usage:  PGPORT=5433 ./setup.sh        (defaults: PG17 brew, port 5433, db "ekler")
# Point the API at it:  DATABASE_URL=postgresql://$(whoami)@localhost:5433/ekler
set -euo pipefail

PGBIN="${PGBIN:-/opt/homebrew/opt/postgresql@17/bin}"
PORT="${PGPORT:-5433}"
SUPER="${PGSUPER:-$(whoami)}"
DB="${PGDATABASE:-ekler}"
DIR="$(cd "$(dirname "$0")" && pwd)"

"$PGBIN/psql"     -p "$PORT" -U "$SUPER" -d postgres -v ON_ERROR_STOP=1 -f "$DIR/00-roles.sql"
"$PGBIN/psql"     -p "$PORT" -U "$SUPER" -d postgres -c "drop database if exists $DB"
"$PGBIN/createdb" -p "$PORT" -U "$SUPER" -O postgres "$DB"
"$PGBIN/psql"     -p "$PORT" -U "$SUPER" -d "$DB" -v ON_ERROR_STOP=1 -f "$DIR/01-bootstrap.sql"
# 02-schema.sql emits one benign 'schema "public" already exists' — do not stop on it.
"$PGBIN/psql"     -p "$PORT" -U "$SUPER" -d "$DB" -f "$DIR/02-schema.sql"
# 03-auth-p8.sql owns the OTP + refresh-session tables; must apply for /v1/auth/* to work.
"$PGBIN/psql"     -p "$PORT" -U "$SUPER" -d "$DB" -v ON_ERROR_STOP=1 -f "$DIR/03-auth-p8.sql"
# 04 — catalog crowdsourcing + UGC-safety blocks (objects missing from the 02 dump).
"$PGBIN/psql"     -p "$PORT" -U "$SUPER" -d "$DB" -v ON_ERROR_STOP=1 -f "$DIR/04-catalog-and-blocks.sql"
# 05 — seed reference data (cities + universities) so .edu.tr logins resolve.
"$PGBIN/psql"     -p "$PORT" -U "$SUPER" -d "$DB" -v ON_ERROR_STOP=1 -f "$DIR/05-seed.sql"
# 06 — seed faculties + departments (onboarding pickers).
"$PGBIN/psql"     -p "$PORT" -U "$SUPER" -d "$DB" -v ON_ERROR_STOP=1 -f "$DIR/06-faculties-departments.sql"

echo "✓ standalone '$DB' ready on :$PORT (DATABASE_URL=postgresql://$SUPER@localhost:$PORT/$DB)"
