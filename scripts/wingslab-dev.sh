#!/usr/bin/env bash
# Local development with hot reload. Only the requested WingsLab app is changed.
set -euo pipefail
cd "$(dirname "$0")/.."
BASE="infrastructure/runtime"
APP="${1:-}"
ACTION="${2:-}"
if [[ -z "$APP" || -z "$ACTION" ]]; then
  echo "Usage: $0 {customer|restaurant|backend} {start|logs|prod|compile}"
  exit 2
fi
if [[ "$APP" == "backend" && "$ACTION" == "compile" ]]; then
  ./node_modules/.bin/tsc -p packages/shared/tsconfig.json
  ./node_modules/.bin/tsc -p packages/backend/tsconfig.json
  ./node_modules/.bin/tsc-alias -p packages/backend/tsconfig.json
  echo "Backend dist recompiled; the container restarts automatically."
  exit 0
fi
OVERLAY="$BASE/compose.${APP}-dev.yml"
[[ -f "$OVERLAY" ]] || { echo "Unknown app: $APP"; exit 2; }
COMMON_ARGS=(
  --context desktop-linux compose
  -f "$BASE/compose.yml"
  -f "$OVERLAY"
  --project-name wingslab-2b
  --env-file "$BASE/runtime.env"
  --profile approved-2b
  --profile approved-backend
  --profile "approved-${APP}"
)
case "$ACTION" in
  start)
    # Both web dev servers can stay active with the capped heap below.
    docker "${COMMON_ARGS[@]}" up -d --no-deps --pull never --force-recreate "$APP"
    echo "$APP development started — edit source and reload."
    ;;
  logs)
    docker "${COMMON_ARGS[@]}" logs --follow "$APP"
    ;;
  prod)
    docker --context desktop-linux compose \
      -f "$BASE/compose.yml" --project-name wingslab-2b \
      --env-file "$BASE/runtime.env" \
      --profile approved-2b --profile approved-backend --profile "approved-${APP}" \
      up -d --no-deps --pull never --force-recreate "$APP"
    echo "$APP restored to its compiled production image."
    ;;
  *)
    echo "Usage: $0 {customer|restaurant|backend} {start|logs|prod|compile}"
    exit 2
    ;;
esac
