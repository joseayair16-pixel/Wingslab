#!/usr/bin/env python3
"""Create/drop a disposable PostgreSQL database and run the local-sale flow.

The live database is read only for schema-only pg_dump. The test database name
is random, contains no live rows, gets the pending migration, and is force-dropped
in finally even if the integration assertions fail.
"""
from pathlib import Path
import json
import subprocess
import urllib.parse
import uuid

ROOT = Path(__file__).resolve().parents[1]
DOCKER = ['docker', '--context', 'desktop-linux']
POSTGRES = 'wingslab-2b-postgres-1'
IMAGE = 'wingslab-backend:loyalty-inperson-candidate-20261117'


def run(args, **kwargs):
    return subprocess.run(args, cwd=ROOT, check=True, **kwargs)


def main():
    source = json.loads((ROOT / 'config/wingslab.local.json').read_text())['backend']['databaseUrl']
    source_url = urllib.parse.urlsplit(source)
    database = 'wl_loyalty_test_' + uuid.uuid4().hex
    netloc = source_url.netloc.rsplit('@', 1)[0] + '@postgres:5432'
    test_url = urllib.parse.urlunsplit((source_url.scheme, netloc, '/' + database,
                                        source_url.query, source_url.fragment))
    created = False
    try:
        has_schema = subprocess.check_output(DOCKER + ['exec', POSTGRES, 'psql', '-U', 'wingslab_owner',
            '-d', 'wingslab_local', '-Atc', "SELECT to_regclass('public.\"LoyaltyScanSession\"') IS NOT NULL AND to_regclass('public.\"LoyaltyVisit\"') IS NOT NULL"], text=True).strip()
        if has_schema != 't':
            raise RuntimeError('El esquema base de fidelidad no está disponible; se detuvo la prueba.')
        run(DOCKER + ['exec', POSTGRES, 'psql', '-U', 'wingslab_owner', '-d', 'wingslab_local',
                      '-v', 'ON_ERROR_STOP=1', '-c', f'CREATE DATABASE "{database}" OWNER wingslab_owner'])
        created = True
        run(DOCKER + ['exec', POSTGRES, 'psql', '-U', 'wingslab_owner', '-d', database,
                      '-v', 'ON_ERROR_STOP=1', '-c',
                      f'GRANT ALL PRIVILEGES ON DATABASE "{database}" TO wingslab_local; GRANT ALL ON SCHEMA public TO wingslab_local'])
        dump = subprocess.check_output(DOCKER + ['exec', POSTGRES, 'pg_dump', '-U', 'wingslab_owner',
            '-d', 'wingslab_local', '--schema-only', '--no-owner', '--no-privileges', '--schema=public'])
        dump = dump.replace(b'CREATE SCHEMA public;\n', b'')
        run(DOCKER + ['exec', '-i', POSTGRES, 'psql', '-U', 'wingslab_local', '-d', database,
                      '-v', 'ON_ERROR_STOP=1'], input=dump)
        run(DOCKER + ['exec', '-i', POSTGRES, 'psql', '-U', 'wingslab_local', '-d', database,
                      '-v', 'ON_ERROR_STOP=1'], input=(ROOT / 'packages/backend/prisma/migrations/20261117150000_loyalty_inperson_sales/migration.sql').read_bytes())
        run(DOCKER + ['run', '--rm', '--network', 'wingslab_2b_internal', '--user', '1000:1000',
                      '--read-only', '--cap-drop', 'ALL', '--security-opt', 'no-new-privileges',
                      '-e', 'WINGSLAB_DATABASE_URL=' + test_url,
                      '-v', f'{ROOT / "scripts/check-loyalty-inperson-isolated.cjs"}:/test/check.cjs:ro',
                      '--entrypoint', 'node', IMAGE, '/test/check.cjs'])
    finally:
        if created:
            run(DOCKER + ['exec', POSTGRES, 'psql', '-U', 'wingslab_owner', '-d', 'wingslab_local',
                          '-v', 'ON_ERROR_STOP=1', '-c', f'DROP DATABASE IF EXISTS "{database}" WITH (FORCE)'])


if __name__ == '__main__':
    main()
