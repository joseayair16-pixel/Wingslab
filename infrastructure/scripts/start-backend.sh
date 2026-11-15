#!/usr/bin/env bash
# Phase 1: never run the legacy migration/deployment sequence.
echo '[WingsLab] Deployment and automatic migrations are blocked.' >&2
exit 1
# Resilient backend startup for Railway.
#
# - Retries `prisma migrate deploy` so a cold start or briefly-unavailable
#   database does not kill the deployment.
# - Retries the backend boot so transient startup errors recover instead of
#   crash-looping straight into a 502.
# - If the boot keeps failing, exits so Railway's ON_FAILURE policy / health
#   checks can cycle the container.

set -u

MAX_MIGRATE_ATTEMPTS=6
MIGRATE_RETRY_DELAY=10
MAX_BOOT_ATTEMPTS=5
BOOT_RETRY_DELAY=15

echo "[start-backend] Starting prisma migrate deploy (up to ${MAX_MIGRATE_ATTEMPTS} attempts)"
for i in $(seq 1 "$MAX_MIGRATE_ATTEMPTS"); do
  if npx prisma migrate deploy --schema=packages/backend/prisma/schema.prisma; then
    echo "[start-backend] prisma migrate deploy OK"
    break
  fi
  echo "[start-backend] prisma migrate deploy attempt ${i}/${MAX_MIGRATE_ATTEMPTS} failed; retrying in ${MIGRATE_RETRY_DELAY}s"
  if [ "$i" -eq "$MAX_MIGRATE_ATTEMPTS" ]; then
    echo "[start-backend] prisma migrate deploy exhausted retries"
    exit 1
  fi
  sleep "$MIGRATE_RETRY_DELAY"
done

echo "[start-backend] Starting backend (up to ${MAX_BOOT_ATTEMPTS} attempts)"
for i in $(seq 1 "$MAX_BOOT_ATTEMPTS"); do
  if node packages/backend/dist/index.js; then
    exit 0
  fi
  exit_code=$?
  echo "[start-backend] backend exited with code ${exit_code} (attempt ${i}/${MAX_BOOT_ATTEMPTS}); retrying in ${BOOT_RETRY_DELAY}s"
  if [ "$i" -eq "$MAX_BOOT_ATTEMPTS" ]; then
    echo "[start-backend] backend exhausted boot retries"
    exit "$exit_code"
  fi
  sleep "$BOOT_RETRY_DELAY"
done
