#!/usr/bin/env python3
"""Layer the updated launcher (CSP with Cloudinary) onto the running frontends.

No rebuild of the app, no downloads, no data mutations. Data containers stay
untouched. PostgreSQL/Redis keep their isolated network.
"""
from pathlib import Path
import json
import shutil
import subprocess
import time
import urllib.request

ROOT = Path('/Users/ayair/Desktop/WingsLab')
WORK = ROOT / 'tmp' / 'reference-build'
DOCKER = ['docker', '--context', 'desktop-linux']
ROLES = [('customer', 3103, 'approved-customer'), ('restaurant', 3102, 'approved-restaurant')]


def run(args, **kwargs):
    return subprocess.run(args, cwd=ROOT, check=True, **kwargs)


def inspect(name):
    return json.loads(subprocess.check_output(DOCKER + ['inspect', name]))[0]


def main():
    before = {role: inspect('wingslab-2b-' + role + '-1')['Id'] for role in ['postgres', 'redis', 'backend']}
    for role, port, profile in ROLES:
        name = 'wingslab-2b-' + role + '-1'
        base_id = inspect(name)['Image']
        base_tag = 'wingslab-' + role + ':base-csp20261119'
        run(DOCKER + ['tag', base_id, base_tag])
        tag = 'wingslab-' + role + ':cloudinary-csp20261119'
        ctx = WORK / (role + '-cloudinary-launcher')
        if ctx.exists():
            shutil.rmtree(ctx)
        ctx.mkdir(parents=True)
        shutil.copy(ROOT / 'config/wingslab.cjs', ctx / 'wingslab.cjs')
        (ctx / 'Dockerfile').write_text(
            'FROM ' + base_tag + '\n'
            'USER 0:0\n'
            'COPY --chown=1000:1000 wingslab.cjs ./config/wingslab.cjs\n'
            'USER 1000:1000\n'
        )
        run(DOCKER + ['buildx', 'build', '--platform', 'linux/arm64', '--network=none',
                      '--pull=false', '--load', '--provenance=false', '-t', tag, str(ctx)])

        env = ROOT / 'infrastructure/runtime/runtime.env'
        previous = env.read_text()
        image = json.loads(subprocess.check_output(DOCKER + ['image', 'inspect', tag]))[0]['Id']
        key = f'WINGSLAB_{role.upper()}_IMAGE='
        env.write_text('\n'.join([line for line in previous.splitlines() if not line.startswith(key)]
                                 + [key + f'wingslab-{role}@' + image]) + '\n')
        env.chmod(0o600)

        compose = ['docker', '--context', 'desktop-linux', 'compose', '-p', 'wingslab-2b',
                   '-f', str(ROOT / 'infrastructure/runtime/compose.yml'), '--env-file', str(env),
                   '--profile', 'approved-2b', '--profile', 'approved-backend', '--profile', profile]
        run(compose + ['config', '--quiet'])
        run(compose + ['up', '-d', '--no-deps', '--pull', 'never', role])

        opener = urllib.request.build_opener(urllib.request.ProxyHandler({}))
        for attempt in range(40):
            try:
                with opener.open(f'http://127.0.0.1:{port}/', timeout=5) as response:
                    assert response.status == 200
                    csp = response.headers.get('Content-Security-Policy', '')
                    assert 'res.cloudinary.com' in csp, csp
                break
            except Exception:
                if attempt == 39:
                    raise
                time.sleep(2)
        print('CSP OK', role, image)
    assert all(inspect('wingslab-2b-' + role + '-1')['Id'] == ident for role, ident in before.items())
    print('DEPLOYED launcher a customer y restaurant; DATA_CONTAINERS_UNCHANGED')


if __name__ == '__main__':
    main()
