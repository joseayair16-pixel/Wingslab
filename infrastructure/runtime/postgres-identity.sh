#!/bin/sh
# WingsLab PostgreSQL bootstrap. Runs ONLY on a brand-new dedicated volume
# (the official image executes /docker-entrypoint-initdb.d once, on an empty PGDATA).
#
# It creates ONLY the application role and the identity marker:
# no business data, no schema, no migrations. Any pre-existing volume is refused
# by the image itself (no initdb), and the backend identity check fails closed.
set -eu
test -n "${WINGSLAB_INSTANCE_ID:-}"
test -s /run/secrets/postgres_app
psql --username "$POSTGRES_USER" --dbname "$POSTGRES_DB" --set=ON_ERROR_STOP=1 \
  --set=instance_id="$WINGSLAB_INSTANCE_ID" --set=app_password="$(cat /run/secrets/postgres_app)" <<'SQL'
CREATE ROLE wingslab_local LOGIN PASSWORD :'app_password' NOSUPERUSER NOCREATEDB NOCREATEROLE;
CREATE SCHEMA wingslab_identity;
CREATE TABLE wingslab_identity.runtime (
  singleton boolean PRIMARY KEY DEFAULT true CHECK (singleton),
  instance_id uuid NOT NULL
);
INSERT INTO wingslab_identity.runtime (instance_id) VALUES (:'instance_id');
REVOKE ALL ON SCHEMA wingslab_identity FROM PUBLIC;
GRANT USAGE ON SCHEMA wingslab_identity TO wingslab_local;
GRANT SELECT ON wingslab_identity.runtime TO wingslab_local;
GRANT CONNECT ON DATABASE wingslab_local TO wingslab_local;
GRANT USAGE, CREATE ON SCHEMA public TO wingslab_local;
SQL
