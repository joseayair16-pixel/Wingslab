from pathlib import Path
import subprocess, json, shutil, sys, urllib.request, time

ROOT = Path('/Users/ayair/Desktop/WingsLab')
WORK = ROOT / 'tmp' / 'reference-build'
WORK.mkdir(parents=True, exist_ok=True)
ROLE = sys.argv[1]
assert ROLE in ['customer', 'restaurant', 'backend'], 'Only WingsLab application services may be deployed'
def run(args, **kw):
    return subprocess.run(args, cwd=ROOT, check=True, **kw)
def inspect(name):
    return json.loads(subprocess.check_output(['docker', 'inspect', name]))[0]
def copy(src, dst):
    shutil.copytree(ROOT / src, dst, ignore=shutil.ignore_patterns('node_modules', '.next', '*.test.*', '*.tsbuildinfo'))
assert shutil.disk_usage(ROOT).free > 12 * 2**30, 'Insufficient free space'
before = {role: inspect('wingslab-2b-' + role + '-1')['Id'] for role in ['postgres', 'redis', 'edge']}
suffix = '-' + sys.argv[2] if len(sys.argv) > 2 else ''
tag = f'wingslab-{ROLE}:menu-content-20261115' + suffix
ctx = WORK / (ROLE + '-context' + suffix)
ctx.mkdir(exist_ok=False)
if ROLE == 'backend':
    run(['node', 'node_modules/typescript/bin/tsc', '-p', 'packages/backend/tsconfig.json'])
    run(['node', 'node_modules/tsc-alias/dist/bin/index.js', '-p', 'packages/backend/tsconfig.json'])
    shutil.copytree(ROOT / 'packages/backend/dist', ctx / 'dist')
    (ctx / 'Dockerfile').write_text('FROM wingslab-backend:20261115\nCOPY --chown=1000:1000 dist ./packages/backend/dist\n')
else:
    source = WORK / (ROLE + '-source' + suffix)
    source.mkdir()
    copy('packages/web-' + ROLE, source / ('packages/web-' + ROLE))
    copy('packages/shared', source / 'packages/shared')
    copy('config', source / 'config')
    copy('scripts', source / 'scripts')
    for file in ['package.json', 'tsconfig.json']:
        shutil.copy2(ROOT / file, source / file)
    # No real secrets enter the build container.
    for config in (source / 'config').glob('*.local.json'):
        config.unlink()
    out = WORK / (ROLE + '-out' + suffix)
    out.mkdir()
    script = f'''set -e
export NEXT_TELEMETRY_DISABLED=1 CHECKPOINT_DISABLE=1
mkdir -p /work
cp -a /src/. /work/
cp -al /app/node_modules /work/node_modules
rm -rf /work/node_modules/@sadel
mkdir -p /work/node_modules/@sadel
ln -s ../../packages/shared /work/node_modules/@sadel/shared
ln -s ../../packages/web-{ROLE} /work/node_modules/@sadel/web-{ROLE}
cd /work
WINGSLAB_OFFLINE_BUILD=yes node scripts/wingslab-build.cjs {ROLE}
rm -rf packages/web-{ROLE}/.next/cache
cp -a packages/web-{ROLE}/.next /out/.next
'''
    run(['docker', 'run', '--rm', '--network=none', '--user', '0:0', '-v', f'{source}:/src:ro', '-v', f'{out}:/out', f'wingslab-{ROLE}:20261115', 'sh', '-lc', script])
    shutil.copytree(out / '.next', ctx / '.next')
    (ctx / 'Dockerfile').write_text(f'FROM wingslab-{ROLE}:20261115\nUSER 0:0\nRUN rm -rf /app/packages/web-{ROLE}/.next\nCOPY --chown=1000:1000 .next ./packages/web-{ROLE}/.next\nUSER 1000:1000\n')
run(['docker', 'buildx', 'build', '--platform', 'linux/arm64', '--network=none', '--pull=false', '--load', '--provenance=false', '-t', tag, str(ctx)])
assert shutil.disk_usage(ROOT).free > 12 * 2**30
env = ROOT / 'infrastructure/runtime/runtime.env'
previous = env.read_text()
(WORK / (ROLE + '-runtime.env.before')).write_text(previous)
(WORK / (ROLE + '-runtime.env.before')).chmod(0o600)
image = json.loads(subprocess.check_output(['docker', 'image', 'inspect', tag]))[0]['Id']
key = f'WINGSLAB_{ROLE.upper()}_IMAGE='
env.write_text('\n'.join([line for line in previous.splitlines() if not line.startswith(key)] + [key + f'wingslab-{ROLE}@' + image]) + '\n')
compose = ['docker', 'compose', '-p', 'wingslab-2b', '-f', str(ROOT / 'infrastructure/runtime/compose.yml'), '--env-file', str(env), '--profile', 'approved-2b', '--profile', 'approved-backend', '--profile', 'approved-apps']
run(compose + ['config', '--quiet'])
run(compose + ['up', '-d', '--no-deps', '--pull', 'never', ROLE])
port = {'backend': 3101, 'restaurant': 3102, 'customer': 3103}[ROLE]
url = f'http://127.0.0.1:{port}' + ('/health' if ROLE == 'backend' else '/')
opener = urllib.request.build_opener(urllib.request.ProxyHandler({}))
for attempt in range(30):
    try:
        with opener.open(url, timeout=5) as response:
            assert response.status == 200
        break
    except Exception:
        if attempt == 29: raise
        time.sleep(2)
assert all(inspect('wingslab-2b-' + role + '-1')['Id'] == ident for role, ident in before.items())
print('DEPLOYED', ROLE, image, 'DATA_CONTAINERS_UNCHANGED', 'FREE_GIB', round(shutil.disk_usage(ROOT).free / 2**30, 1))
