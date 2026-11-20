#!/usr/bin/env bash
# Customer-only local development with hot reload. Does not touch other apps.
set -euo pipefail
cd "$(dirname "$0")/.."
BASE="infrastructure/runtime"
COMMON_ARGS=(
  --context desktop-linux compose
  -f "$BASE/compose.yml"
  -f "$BASE/compose.customer-dev.yml"
  --project-name wingslab-2b
  --env-file "$BASE/runtime.env"
  --profile approved-2b
  --profile approved-backend
  --profile approved-customer
)

case "${1:-}" in
  start)
    docker "${COMMON_ARGS[@]}" up -d --no-deps --pull never --force-recreate customer
    echo "Customer development started at http://127.0.0.1:3103 — edit source and reload."
    ;;
  logs)
    docker "${COMMON_ARGS[@]}" logs --follow customer
    ;;
  stop)
    docker "${COMMON_ARGS[@]}" down --remove-orphans
    echo "Development overlay stopped (data volumes preserved)."
    ;;
  prod)
    docker --context desktop-linux compose \
      -f "$BASE/compose.yml" --project-name wingslab-2b \
      --env-file "$BASE/runtime.env" \
      --profile approved-2b --profile approved-backend --profile approved-customer \
      up -d --no-deps --pull never --force-recreate customer
    echo "Customer restored to the compiled production image."
    ;;
  *)
    echo "Usage: $0 {start|logs|stop|prod}"
    exit 2
    ;;
esac
