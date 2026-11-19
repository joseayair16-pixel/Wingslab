#!/usr/bin/env python3
"""Deploy one WingsLab frontend offline reusing the verified running image.

The build runs inside the container with --network=none and the already
verified dependency tree; only the compiled .next is layered on the image
that is currently running. No downloads and no data operations.
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
DOCKER = ['docker', '--context', 'desktop-linux']
ROLE = sys.argv[1]
BASE_TAG = sys.argv[2]
TAG = sys.argv[3]
PORT = int(sys.argv[4])
PROFILE = sys.argv[5]
MODE = sys.argv[6] if len(sys.argv) > 6 else 'deploy'

assert ROLE in ['restaurant', 'customer', 'driver'], 'Only WingsLab frontends may be deployed'
assert MODE in ['build-only', 'deploy'], 'Mode must be build-only or deploy'
CTX = WORK / (ROLE + '-context-' + TAG.split('-')[-1])
SOURCE = WORK / (ROLE + '-source-' + TAG.split('-')[-1])
OUT = WORK / (ROLE + '-out-' + TAG.split('-')[-1])


def run(args, **kwargs):
    return subprocess.run(args, cwd=ROOT, check=True, **kwargs)


def inspect(name):
    return json.loads(subprocess.check_output(DOCKER + ['inspect', name]))[0]


def copy_tree(relative, destination):
    shutil.copytree(ROOT / relative, destination,
                    ignore=shutil.ignore_patterns('node_modules', '.next', '*.test.*', '*.tsbuildinfo'))


def main():
    assert shutil.disk_usage(ROOT).free > 8 * 2**30, 'Insufficient free space'
    config_source = ROOT / 'config'
    assert not config_source.is_symlink(), 'Configuration directory must be a regular directory'
    assert not any(path.is_symlink() for path in config_source.iterdir()), 'Linked configuration files are prohibited'
    before = {role: inspect('wingslab-2b-' + role + '-1')['Id'] for role in ['postgres', 'redis']}

    for path in (CTX, SOURCE, OUT):
        if path.exists():
            shutil.rmtree(path)
    CTX.mkdir(parents=True)
    SOURCE.mkdir(parents=True)
    OUT.mkdir(parents=True)

    copy_tree('packages/web-' + ROLE, SOURCE / ('packages/web-' + ROLE))
    copy_tree('packages/shared', SOURCE / 'packages/shared')
    copy_tree('config', SOURCE / 'config')
    copy_tree('scripts', SOURCE / 'scripts')
    for file in ['package.json', 'tsconfig.json']:
        shutil.copy2(ROOT / file, SOURCE / file)
    for extra in ['firebase', 'idb'] + [p.name for p in (ROOT / 'node_modules/@firebase').iterdir() if p.is_dir()]:
        src = ROOT / 'node_modules' / (extra if extra in ('firebase', 'idb') else Path('@firebase') / extra)
        dst = SOURCE / 'node_modules' / (extra if extra in ('firebase', 'idb') else Path('@firebase') / extra)
        dst.parent.mkdir(parents=True, exist_ok=True)
        if dst.exists(): shutil.rmtree(dst)
        shutil.copytree(src, dst)
    if ROLE == 'customer':
        # qrcode.react was added to the customer app after its pinned base
        # image was built; stage the already-reviewed locked dependency, with
        # no package installation or network access during the image build.
        qr_source = ROOT / 'node_modules' / 'qrcode.react'
        assert qr_source.is_dir() and not qr_source.is_symlink(), 'qrcode.react must exist in the reviewed local dependency tree'
        qr_stage = SOURCE / 'node_modules' / 'qrcode.react'
        qr_stage.parent.mkdir(parents=True, exist_ok=True)
        shutil.copytree(qr_source, qr_stage)
    # No local JSON configuration (including *.local.host.json) enters the
    # build container; only the reviewed policy module is needed for the build.
    for config in (SOURCE / 'config').glob('*.json'):
        config.unlink()
    assert not list((SOURCE / 'config').glob('*.json')), 'Configuration JSON leaked into the build context'

    script = f'''set -e
export NEXT_TELEMETRY_DISABLED=1 CHECKPOINT_DISABLE=1
mkdir -p /work
cp -a /src/. /work/
mkdir -p /work/node_modules
cp -al /app/node_modules/. /work/node_modules/
rm -rf /work/node_modules/@sadel
mkdir -p /work/node_modules/@sadel
ln -s ../../packages/shared /work/node_modules/@sadel/shared
if [ '{ROLE}' = 'customer' ]; then
  rm -rf /work/node_modules/qrcode.react /work/node_modules/firebase /work/node_modules/@firebase /work/node_modules/idb
  cp -a /src/node_modules/qrcode.react /work/node_modules/qrcode.react
  cp -a /src/node_modules/firebase /work/node_modules/firebase
  cp -a /src/node_modules/@firebase /work/node_modules/@firebase
  cp -a /src/node_modules/idb /work/node_modules/idb
fi
cd /work
WINGSLAB_OFFLINE_BUILD=yes node scripts/wingslab-build.cjs {ROLE}
rm -rf packages/web-{ROLE}/.next/cache
cp -a packages/web-{ROLE}/.next /out/.next
'''
    run(DOCKER + ['run', '--rm', '--network=none', '--user', '0:0',
                  '-v', f'{SOURCE}:/src:ro', '-v', f'{OUT}:/out', BASE_TAG, 'sh', '-lc', script])

    shutil.copytree(OUT / '.next', CTX / '.next')
    (CTX / 'Dockerfile').write_text(
        f'FROM {BASE_TAG}\n'
        'USER 0:0\n'
        f'RUN rm -rf /app/packages/web-{ROLE}/.next\n'
        f'COPY --chown=1000:1000 .next ./packages/web-{ROLE}/.next\n'
        'USER 1000:1000\n'
    )

    run(DOCKER + ['buildx', 'build', '--platform', 'linux/arm64', '--network=none',
                  '--pull=false', '--load', '--provenance=false', '-t', TAG, str(CTX)])

    check = (
        "const fs=require('fs'),a=require('assert/strict');"
        f"a(fs.existsSync('packages/web-{ROLE}/.next/BUILD_ID'));"
        "a(fs.readdirSync('packages/web-' + process.env.WINGSLAB_ROLE).length > 0);"
    )
    run(DOCKER + ['run', '--rm', '--network', 'none', '--read-only', '--entrypoint', 'node', TAG,
                  '-e', f"process.env.WINGSLAB_ROLE='{ROLE}';" + check])

    if MODE == 'build-only':
        print('BUILT', ROLE, json.loads(subprocess.check_output(DOCKER + ['image', 'inspect', TAG]))[0]['Id'])
        return

    env = ROOT / 'infrastructure/runtime/runtime.env'
    previous = env.read_text()
    backup = WORK / (ROLE + '-runtime.env.before-' + TAG.split('-')[-1])
    backup.write_text(previous)
    backup.chmod(0o600)
    image = json.loads(subprocess.check_output(DOCKER + ['image', 'inspect', TAG]))[0]['Id']
    key = f'WINGSLAB_{ROLE.upper()}_IMAGE='
    env.write_text('\n'.join([line for line in previous.splitlines() if not line.startswith(key)]
                             + [key + f'wingslab-{ROLE}@' + image]) + '\n')
    env.chmod(0o600)

    compose = ['docker', '--context', 'desktop-linux', 'compose', '-p', 'wingslab-2b',
               '-f', str(ROOT / 'infrastructure/runtime/compose.yml'), '--env-file', str(env),
               '--profile', 'approved-2b', '--profile', 'approved-backend', '--profile', PROFILE]
    run(compose + ['config', '--quiet'])
    run(compose + ['up', '-d', '--no-deps', '--pull', 'never', ROLE])

    opener = urllib.request.build_opener(urllib.request.ProxyHandler({}))
    for attempt in range(40):
        try:
            with opener.open(f'http://127.0.0.1:{PORT}/', timeout=5) as response:
                assert response.status == 200
            break
        except Exception:
            if attempt == 39:
                raise
            time.sleep(2)

    assert all(inspect('wingslab-2b-' + role + '-1')['Id'] == ident for role, ident in before.items())
    print('DEPLOYED', ROLE, image, 'DATA_CONTAINERS_UNCHANGED')


if __name__ == '__main__':
    main()
