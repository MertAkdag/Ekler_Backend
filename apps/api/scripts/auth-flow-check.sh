#!/usr/bin/env bash
# Behavioral smoke for the own-auth (P8) cutover surface — runs the real OTP →
# verify → protected-call → refresh-rotate → reuse-revoke → family-cap path against
# the standalone PG17 DB, plus the JWKS endpoint. Complements the pure-unit
# token.service.spec.ts (crypto) and k1-isolation-check.sh (scope).
#
# Prereqs: standalone DB up (db/standalone/setup.sh — applies 03-auth-p8.sql), API
# built (pnpm build), an env file pointing DATABASE_URL→standalone + AUTH_JWT_* keys.
#
# Usage:  API_ENV=/tmp/api-p8.env PGPORT=5433 PORT=3007 ./scripts/auth-flow-check.sh
set -euo pipefail

API_ENV="${API_ENV:?set API_ENV to the dotenv file (standalone DB + AUTH_JWT_* keys)}"
PGBIN="${PGBIN:-/opt/homebrew/opt/postgresql@17/bin}"
PGPORT="${PGPORT:-5433}"
PGDB="${PGDB:-ekler}"
PGUSER="${PGUSER:-$(whoami)}"
PORT="${PORT:-3007}"
DIR="$(cd "$(dirname "$0")/.." && pwd)"
PSQL=("$PGBIN/psql" -p "$PGPORT" -U "$PGUSER" -d "$PGDB" -At)
B="http://127.0.0.1:${PORT}/v1"
EMAIL="p8smoke@boun.edu.tr"
LOG=$(mktemp)

jq_get() { node -e "let s='';process.stdin.on('data',d=>s+=d).on('end',()=>{try{process.stdout.write(String(eval('('+JSON.stringify(JSON.parse(s))+')')$1))}catch(e){process.stdout.write('')}})"; }
pass() { echo "PASS  $1"; }
fail() { echo "FAIL  $1"; kill "$PID" 2>/dev/null || true; exit 1; }

# Ensure the test university exists + clean prior runs.
"${PSQL[@]}" -c "
  insert into public.cities(id,name) select gen_random_uuid(),'_p8city' where not exists (select 1 from public.cities where name='_p8city');
  insert into public.universities(id,name,domain,city_id) select gen_random_uuid(),'BOUN','boun.edu.tr',(select id from public.cities where name='_p8city')
    where not exists (select 1 from public.universities where domain='boun.edu.tr');
  delete from public.auth_otp_codes where email='$EMAIL';" >/dev/null

DOTENV_CONFIG_PATH="$API_ENV" PORT="$PORT" node "$DIR/dist/main.js" > "$LOG" 2>&1 &
PID=$!
trap 'kill $PID 2>/dev/null || true; rm -f "$LOG"' EXIT
sleep 6

# 1) JWKS endpoint serves our public key (raw, un-enveloped).
JWKS_KID=$(curl -s "http://127.0.0.1:${PORT}/.well-known/jwks.json" | jq_get ".keys[0].kid")
[[ "$JWKS_KID" == "ek-ed25519-1" ]] && pass "JWKS serves kid=$JWKS_KID" || fail "JWKS missing/wrong kid (got '$JWKS_KID')"

# 2) OTP request → 204.
ST=$(curl -s -o /dev/null -w '%{http_code}' -X POST "$B/auth/otp/request" -H 'content-type: application/json' -d "{\"email\":\"$EMAIL\"}")
[[ "$ST" == "204" ]] && pass "otp/request → 204" || fail "otp/request → $ST"
sleep 0.4
CODE=$(grep "$EMAIL" "$LOG" | grep -oE 'code [0-9]{6}' | grep -oE '[0-9]{6}' | tail -1)
[[ -n "$CODE" ]] && pass "OTP code issued ($CODE)" || fail "no OTP code in log"

# 3) verify → access + refresh.
V=$(curl -s -X POST "$B/auth/otp/verify" -H 'content-type: application/json' -d "{\"email\":\"$EMAIL\",\"code\":\"$CODE\"}")
ACCESS=$(echo "$V" | jq_get ".data.access_token"); REFRESH=$(echo "$V" | jq_get ".data.refresh_token")
[[ -n "$ACCESS" && -n "$REFRESH" ]] && pass "otp/verify issued tokens" || fail "verify gave no tokens ($V)"

# 4) protected route accepts the OWN access token (guard own-EdDSA path).
ME=$(curl -s -o /dev/null -w '%{http_code}' "$B/me" -H "authorization: Bearer $ACCESS")
[[ "$ME" == "200" ]] && pass "GET /me with own token → 200" || fail "GET /me → $ME"

# 5) refresh rotates → new tokens.
R1=$(curl -s -X POST "$B/auth/refresh" -H 'content-type: application/json' -d "{\"refresh_token\":\"$REFRESH\"}")
REFRESH2=$(echo "$R1" | jq_get ".data.refresh_token")
[[ -n "$REFRESH2" && "$REFRESH2" != "$REFRESH" ]] && pass "refresh rotated the token" || fail "refresh did not rotate ($R1)"

# 6) replay the OLD refresh → reuse detected → INVALID_REFRESH + whole family revoked.
RE=$(curl -s -X POST "$B/auth/refresh" -H 'content-type: application/json' -d "{\"refresh_token\":\"$REFRESH\"}")
RECODE=$(echo "$RE" | jq_get ".error.code")
[[ "$RECODE" == "INVALID_REFRESH" ]] && pass "reuse → INVALID_REFRESH" || fail "reuse not blocked ($RE)"
# the rotated token must now be dead too (family revoked on reuse).
RR=$(curl -s -X POST "$B/auth/refresh" -H 'content-type: application/json' -d "{\"refresh_token\":\"$REFRESH2\"}")
[[ "$(echo "$RR" | jq_get '.error.code')" == "INVALID_REFRESH" ]] && pass "family revoked on reuse" || fail "rotated token survived reuse ($RR)"

# 7) family absolute cap: fresh session, force family_expires_at into the past, refresh → dead.
"${PSQL[@]}" -c "delete from public.auth_otp_codes where email='$EMAIL';" >/dev/null
curl -s -X POST "$B/auth/otp/request" -H 'content-type: application/json' -d "{\"email\":\"$EMAIL\"}" >/dev/null
sleep 0.4
CODE2=$(grep "$EMAIL" "$LOG" | grep -oE 'code [0-9]{6}' | grep -oE '[0-9]{6}' | tail -1)
V2=$(curl -s -X POST "$B/auth/otp/verify" -H 'content-type: application/json' -d "{\"email\":\"$EMAIL\",\"code\":\"$CODE2\"}")
REFRESH3=$(echo "$V2" | jq_get ".data.refresh_token"); USERID=$(echo "$V2" | jq_get ".data.user.id")
"${PSQL[@]}" -c "update public.auth_sessions set family_expires_at = now() - interval '1 day' where user_id='$USERID' and revoked_at is null;" >/dev/null
FC=$(curl -s -X POST "$B/auth/refresh" -H 'content-type: application/json' -d "{\"refresh_token\":\"$REFRESH3\"}")
[[ "$(echo "$FC" | jq_get '.error.code')" == "INVALID_REFRESH" ]] && pass "expired family → INVALID_REFRESH" || fail "family cap not enforced ($FC)"
REASON=$("${PSQL[@]}" -c "select revoked_reason from public.auth_sessions where user_id='$USERID' order by created_at desc limit 1;")
[[ "$REASON" == "family_expired" ]] && pass "revoked_reason=family_expired" || fail "wrong revoke reason ($REASON)"

# cleanup test rows
"${PSQL[@]}" -c "delete from public.auth_sessions where user_id='$USERID'; delete from public.auth_otp_codes where email='$EMAIL';" >/dev/null
echo "✓ own-auth (P8) flow holds: JWKS, OTP, protected-call, rotation, reuse-revoke, family-cap"
