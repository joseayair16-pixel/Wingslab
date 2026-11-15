#!/bin/sh
# WingsLab Redis bootstrap. Runs only on a NEW dedicated volume.
# Prepares the identity marker and refuses to adopt pre-existing data.
set -eu
test -n "${WINGSLAB_INSTANCE_ID:-}"
umask 077
mkdir -p /run/wingslab
password=$(cat /run/secrets/redis_app)
test "${#password}" -ge 32
case "$password" in *[!A-Za-z0-9_-]*|'') echo 'Use a newly generated base64url password.' >&2; exit 1;; esac
if id redis >/dev/null 2>&1; then
  chown redis:redis /data 2>/dev/null || true
else
  echo 'redis user missing in image' >&2
  exit 1
fi
printf 'appendonly yes\ndir /data\nrequirepass %s\n' "$password" > /run/wingslab/redis.conf
chown redis:redis /run/wingslab/redis.conf
redis-server /run/wingslab/redis.conf --user redis &
pid=$!
trap 'kill "$pid" 2>/dev/null || true' EXIT INT TERM
export REDISCLI_AUTH="$password"
ready=false
for attempt in 1 2 3 4 5 6 7 8 9 10; do
  if redis-cli PING >/dev/null 2>&1; then ready=true; break; fi
  sleep 1
done
test "$ready" = true
identity=$(redis-cli --raw GET wingslab:identity)
if test -z "$identity"; then
  if redis-cli --raw INFO keyspace | grep -q '^db'; then
    echo 'Refusing to identify a Redis instance containing pre-existing data.' >&2
    exit 1
  fi
  redis-cli SET wingslab:identity "$WINGSLAB_INSTANCE_ID" NX >/dev/null
else
  test "$identity" = "$WINGSLAB_INSTANCE_ID"
fi
touch /run/wingslab/ready
chown redis:redis /run/wingslab/ready
wait "$pid"
