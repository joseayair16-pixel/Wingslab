#!/usr/bin/env python3
"""Deploy backend with the Cloudinary storage provider, layered on the currently running image.

No downloads, no schema changes and no data mutations: only the compiled
dist and the freshly generated Prisma client are layered on the image that is
already running and whose dependencies were verified previously.
"""
from pathlib import Path
import json
import shutil
import subprocess
import sys
import time
import urllib.request

ROOT = Path('/Users/ayair/Desktop/WingsLab')
WORK = ROOT / 'tmp' / 'reference-build'
BASE_TAG = 'wingslab-backend:auth-scope-fix20261119'
TAG = 'wingslab-backend:cloudinary-final20261119'
CTX = WORK / 'backend-context-cloudinary20261119'
DOCKER = ['docker', '--context', 'desktop-linux']


def run(args, **kwargs):
    return subprocess.run(args, cwd=ROOT, check=True, **kwargs)


def inspect(name):
    return json.loads(subprocess.check_output(DOCKER + ['inspect', name]))[0]


def main():
    assert shutil.disk_usage(ROOT).free > 8 * 2**30, 'Insufficient free space'
    before = {role: inspect('wingslab-2b-' + role + '-1')['Id'] for role in ['postgres', 'redis']}

    if CTX.exists():
        shutil.rmtree(CTX)
    CTX.mkdir(parents=True)

    shutil.copytree(ROOT / 'packages/backend/dist', CTX / 'dist')
    # The Prisma client must match the migrated schema, including the musl
    # query engine that already ships inside the verified base image.
    shutil.copytree(ROOT / 'node_modules/.prisma/client', CTX / 'prisma-client')
    shutil.copy(ROOT / 'config/wingslab.cjs', CTX / 'wingslab.cjs')
    (CTX / 'Dockerfile').write_text(
        'FROM ' + BASE_TAG + '\n'
        'USER 0:0\n'
        'RUN rm -rf /app/packages/backend/dist /app/node_modules/.prisma/client\n'
        'COPY --chown=1000:1000 dist ./packages/backend/dist\n'
        'COPY --chown=1000:1000 prisma-client ./node_modules/.prisma/client\n'
    'COPY --chown=1000:1000 wingslab.cjs ./config/wingslab.cjs\n'
        'USER 1000:1000\n'
    )

    run(DOCKER + ['buildx', 'build', '--platform', 'linux/arm64', '--network=none',
                  '--pull=false', '--load', '--provenance=false', '-t', TAG, str(CTX)])

    # The image must load the generated client and the musl query engine.
    check = (
        "const fs=require('fs'),a=require('assert/strict');"
        "a(fs.existsSync('packages/backend/dist/app.js'));"
        "a(fs.existsSync('node_modules/.prisma/client/index.js'));"
        "a(fs.existsSync('node_modules/.prisma/client/libquery_engine-linux-musl-arm64-openssl-3.0.x.so.node'));"
        "const s=fs.readFileSync('node_modules/.prisma/client/schema.prisma','utf8');"
        "a(s.includes('model DriverEarning'));a(s.includes('driverCompensation'));"
    )
    run(DOCKER + ['run', '--rm', '--network', 'none', '--read-only', '--entrypoint', 'node', TAG, '-e', check])

    env = ROOT / 'infrastructure/runtime/runtime.env'
    previous = env.read_text()
    backup = WORK / 'backend-runtime.env.before-cloudinary'
    backup.write_text(previous)
    backup.chmod(0o600)
    image = json.loads(subprocess.check_output(DOCKER + ['image', 'inspect', TAG]))[0]['Id']
    key = 'WINGSLAB_BACKEND_IMAGE='
    env.write_text('\n'.join([line for line in previous.splitlines() if not line.startswith(key)]
                             + [key + 'wingslab-backend@' + image]) + '\n')
    env.chmod(0o600)

    compose = ['docker', '--context', 'desktop-linux', 'compose', '-p', 'wingslab-2b',
               '-f', str(ROOT / 'infrastructure/runtime/compose.yml'), '--env-file', str(env),
               '--profile', 'approved-2b', '--profile', 'approved-backend']
    run(compose + ['config', '--quiet'])
    run(compose + ['up', '-d', '--no-deps', '--pull', 'never', 'backend'])

    opener = urllib.request.build_opener(urllib.request.ProxyHandler({}))
    for attempt in range(40):
        try:
            with opener.open('http://127.0.0.1:3101/health', timeout=5) as response:
                assert response.status == 200
                assert json.load(response)['status'] == 'ok'
            break
        except Exception:
            if attempt == 39:
                raise
            time.sleep(2)

    assert all(inspect('wingslab-2b-' + role + '-1')['Id'] == ident for role, ident in before.items())
    print('DEPLOYED backend', image, 'DATA_CONTAINERS_UNCHANGED')


if __name__ == '__main__':
    main()
