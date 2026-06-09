#!/usr/bin/env bash
# Behavioral anti-K-1 (cross-university leak) check — the migration's #1 risk.
#
# Boots the API against the standalone PG17 DB, creates two users in two different
# universities via the real own-auth OTP flow, seeds one confession per university,
# then asserts each user's feed shows ONLY their university's content (no leak, both
# directions). This is the runtime counterpart to the static scope-guard unit test.
#
# Prereqs: standalone DB up (db/standalone/setup.sh, +03-auth-p8.sql), API built
# (pnpm build), a test env with DATABASE_URL→standalone + own-auth keys.
#
# Usage:  API_ENV=/tmp/api-p8.env PGPORT=5433 ./scripts/k1-isolation-check.sh
set -euo pipefail

API_ENV="${API_ENV:?set API_ENV to the dotenv file pointing at the standalone DB + AUTH_JWT_* keys}"
PGBIN="${PGBIN:-/opt/homebrew/opt/postgresql@17/bin}"
PGPORT="${PGPORT:-5433}"
PGDB="${PGDB:-ekler}"
PGUSER="${PGUSER:-$(whoami)}"
PORT="${PORT:-3001}"
DIR="$(cd "$(dirname "$0")/.." && pwd)"
PSQL=("$PGBIN/psql" -p "$PGPORT" -U "$PGUSER" -d "$PGDB" -At)
B="http://127.0.0.1:${PORT}/v1"
LOG=$(mktemp)

# Seed two universities (idempotent).
"${PSQL[@]}" -c "
  insert into public.cities(id,name) select gen_random_uuid(),'_k1city' where not exists (select 1 from public.cities where name='_k1city');
  insert into public.universities(id,name,domain,city_id) select gen_random_uuid(),'K1-A','k1a.edu.tr',(select id from public.cities where name='_k1city')
    where not exists (select 1 from public.universities where domain='k1a.edu.tr');
  insert into public.universities(id,name,domain,city_id) select gen_random_uuid(),'K1-B','k1b.edu.tr',(select id from public.cities where name='_k1city')
    where not exists (select 1 from public.universities where domain='k1b.edu.tr');
  delete from public.confessions where body like 'K1-%';
  delete from public.auth_otp_codes where email in ('a@k1a.edu.tr','b@k1b.edu.tr');" >/dev/null

DOTENV_CONFIG_PATH="$API_ENV" node "$DIR/dist/main.js" > "$LOG" 2>&1 &
PID=$!
trap 'kill $PID 2>/dev/null || true; rm -f "$LOG"' EXIT
sleep 6

auth() { # $1=email → prints verify JSON
  curl -s -X POST "$B/auth/otp/request" -H 'content-type: application/json' -d "{\"email\":\"$1\"}" >/dev/null
  sleep 0.5
  local code; code=$(grep "$1" "$LOG" | grep -oE 'code [0-9]{6}' | grep -oE '[0-9]{6}' | tail -1)
  curl -s -X POST "$B/auth/otp/verify" -H 'content-type: application/json' -d "{\"email\":\"$1\",\"code\":\"$code\"}"
}
auth a@k1a.edu.tr > /tmp/_k1a.json
auth b@k1b.edu.tr > /tmp/_k1b.json
TA=$(node -e "console.log(require('/tmp/_k1a.json').data.access_token)")
IA=$(node -e "console.log(require('/tmp/_k1a.json').data.user.id)")
TB=$(node -e "console.log(require('/tmp/_k1b.json').data.access_token)")
IB=$(node -e "console.log(require('/tmp/_k1b.json').data.user.id)")

"${PSQL[@]}" -c "insert into public.confessions(author_id,body,university_domain) values
  ('$IA','K1-A-SECRET','k1a.edu.tr'),('$IB','K1-B-SECRET','k1b.edu.tr');" >/dev/null

assert() { # $1=token $2=must-see $3=must-not-see $4=label
  local bodies; bodies=$(curl -s "$B/confessions/feed" -H "authorization: Bearer $1" \
    | node -e "let s='';process.stdin.on('data',d=>s+=d).on('end',()=>process.stdout.write(JSON.stringify((JSON.parse(s).data||[]).map(x=>x.body))))")
  if [[ "$bodies" == *"$2"* && "$bodies" != *"$3"* ]]; then
    echo "PASS  $4: sees own, no leak  ($bodies)"
  else
    echo "FAIL  $4: LEAK or missing  ($bodies)"; exit 1
  fi
}
assert "$TA" K1-A-SECRET K1-B-SECRET "user A (k1a)"
assert "$TB" K1-B-SECRET K1-A-SECRET "user B (k1b)"
echo "✓ anti-K-1 behavioral isolation holds (both directions)"
