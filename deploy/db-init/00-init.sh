#!/bin/bash
# Runs ONCE, the first time the postgres volume is empty (docker-entrypoint-initdb.d).
# Loads the standalone recipe in order. 02-schema emits one benign
# "schema public already exists" — that file alone runs WITHOUT ON_ERROR_STOP,
# exactly like apps/api/db/standalone/setup.sh does locally.
set -e
DIR=/standalone
PSQL=(psql -v ON_ERROR_STOP=1 --username "$POSTGRES_USER" --dbname "$POSTGRES_DB")

echo "[db-init] 00-roles"   ; "${PSQL[@]}" -f "$DIR/00-roles.sql"
echo "[db-init] 01-bootstrap"; "${PSQL[@]}" -f "$DIR/01-bootstrap.sql"
echo "[db-init] 02-schema"  ; psql --username "$POSTGRES_USER" --dbname "$POSTGRES_DB" -f "$DIR/02-schema.sql"
echo "[db-init] 03-auth-p8" ; "${PSQL[@]}" -f "$DIR/03-auth-p8.sql"
echo "[db-init] 04-catalog-and-blocks"; "${PSQL[@]}" -f "$DIR/04-catalog-and-blocks.sql"
echo "[db-init] done — ekler schema ready"
