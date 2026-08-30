#!/usr/bin/env bash
# One command: Postgres + api + web.
set -euo pipefail
cd "$(dirname "$0")"

DB_NAME=rafter
export DATABASE_URL="${DATABASE_URL:-postgresql://$USER@localhost:5432/$DB_NAME}"

if ! pg_isready -q 2>/dev/null; then
  if command -v docker >/dev/null; then
    echo "Starting Postgres 16 in Docker..."
    docker start rafter-pg 2>/dev/null || docker run -d --name rafter-pg \
      -e POSTGRES_USER=rafter -e POSTGRES_PASSWORD=rafter -e POSTGRES_DB=$DB_NAME \
      -p 5432:5432 postgres:16
    export DATABASE_URL="postgresql://rafter:rafter@localhost:5432/$DB_NAME"
    until pg_isready -h localhost -q; do sleep 1; done
  else
    echo "Postgres is not running and Docker is unavailable." >&2; exit 1
  fi
fi

psql -lqt 2>/dev/null | cut -d'|' -f1 | grep -qw $DB_NAME || createdb $DB_NAME 2>/dev/null || true

pnpm install
pnpm --filter @rafter/db exec prisma migrate deploy
pnpm --filter @rafter/db run seed
pnpm dev
