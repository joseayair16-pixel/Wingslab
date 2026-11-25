#!/usr/bin/env bash
set -euo pipefail
cd "$(dirname "$0")/.."
network=wl-kitchen-$(openssl rand -hex 6)
pg=$network-db
db_image=$(docker inspect wingslab-2b-postgres-1 --format '{{.Image}}')
app_image=$(docker inspect wingslab-2b-backend-1 --format '{{.Image}}')
trap 'docker rm -fv "$pg" >/dev/null 2>&1 || true; docker network rm "$network" >/dev/null 2>&1 || true' EXIT
docker network create --internal "$network" >/dev/null
docker run --pull=never -d --name "$pg" --network "$network" --network-alias sandbox-db \
  -e POSTGRES_PASSWORD=fixture-only -e POSTGRES_DB=checkout_fixture "$db_image" >/dev/null
for ((i=0; i<30; i++)); do
  if docker exec "$pg" pg_isready -h 127.0.0.1 -U postgres >/dev/null 2>&1; then break; fi
  sleep 1
done
docker exec wingslab-2b-postgres-1 pg_dump -U wingslab_owner -d wingslab_local --schema-only --no-owner --no-privileges --schema=public |
  sed '/^CREATE SCHEMA public;$/d' |
  docker exec -i "$pg" psql -q -U postgres -d checkout_fixture -v ON_ERROR_STOP=1 >/dev/null
docker run --pull=never --rm -i --network "$network" -e WINGSLAB_MODE=test \
  -e TEST_DATABASE_URL=postgresql://postgres:fixture-only@sandbox-db:5432/checkout_fixture \
  -v "$PWD/node_modules/.prisma/client:/app/node_modules/.prisma/client:ro" \
  -v "$PWD/packages/backend/dist:/app/packages/backend/dist:ro" \
  -v "$PWD/packages/shared/dist:/app/packages/shared/dist:ro" \
  -v "$PWD/packages/shared/src/wingslab-policy.cjs:/app/packages/shared/src/wingslab-policy.cjs:ro" \
  -v "$PWD/scripts/check-sandbox-kitchen.cjs:/app/check-sandbox-kitchen.cjs:ro" \
  --entrypoint node "$app_image" /app/check-sandbox-kitchen.cjs "$@"
