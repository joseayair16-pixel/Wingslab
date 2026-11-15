#!/usr/bin/env python3
"""Scoped offline builds/deployment. No data operations; stop on storage trouble."""
from pathlib import Path
import subprocess, shutil, time, json, re, urllib.request, os, argparse

parser = argparse.ArgumentParser()
parser.add_argument('--presentation', action='store_true')
parser.add_argument('--single-restaurant', action='store_true')
args = parser.parse_args()

ROOT = Path(__file__).resolve().parent.parent
TMP = Path('/private/var/folders/bp/fw91jby178j6336lpfmmd84m0000gn/T/opencode')
WORK = TMP / ('wingslab-single-restaurant' if args.single_restaurant else 'wingslab-presentation-final' if args.presentation else 'wingslab-own-delivery')
WORK.mkdir(mode=0o700, exist_ok=True)
B = ['docker', '--context', 'desktop-linux']
def run(args, **kw):
    return subprocess.run(B + args, capture_output=True, text=True, check=True, timeout=90, **kw).stdout
def inspect(name): return json.loads(run(['inspect', name]))[0]
def space(): return shutil.disk_usage(ROOT).free / 2**30

before = {n: inspect(f'wingslab-2b-{n}-1') for n in ['backend', 'restaurant', 'customer', 'edge', 'postgres', 'redis']}
assert before['postgres']['State']['Health']['Status'] == before['redis']['State']['Health']['Status'] == 'healthy'
for name, d in before.items():
    assert d['Config']['Labels']['org.wingslab.project'] == 'wingslab'
assert space() > 8, 'Insufficient host space before build; no cleanup authorized'
opener = urllib.request.build_opener(urllib.request.ProxyHandler({}))
for role in (['restaurant', 'customer'] if args.presentation else ['backend', 'restaurant', 'customer']):
    context = WORK / f'{role}-context'
    assert not context.exists(), 'Use a new context; do not overwrite/repeat a failed build'
    downloads = TMP / ('wingslab-2c-wad1euux/downloads' if role == 'backend' else 'wingslab-3-client-lgrtv2ao/downloads')
    stage = ['python3', str(ROOT / 'scripts' / ('wingslab-stage-backend.py' if role == 'backend' else 'wingslab-stage-customer.py')), str(context), str(downloads)]
    if role != 'backend': stage.append(role)
    print('STAGE', role, 'FREE_GiB', round(space(), 2), flush=True)
    subprocess.run(stage, cwd=ROOT, check=True, timeout=240)
    dockerfile = f'Dockerfile.{role}'
    shutil.copyfile(ROOT / 'infrastructure/runtime' / dockerfile, context / dockerfile)
    log = WORK / f'{role}-build.log'
    tag = f'wingslab-{role}:' + ('single-restaurant' if args.single_restaurant else 'phase3e' if args.presentation else 'phase3d')
    with log.open('w') as output:
        proc = subprocess.Popen(B + ['buildx', 'build', '--platform', 'linux/arm64', '--network', 'none', '--pull=false', '--progress', 'plain', '--load', '--provenance=false', '-t', tag, '-f', str(context / dockerfile), str(context)], stdout=output, stderr=subprocess.STDOUT, cwd=ROOT)
        deadline = time.monotonic() + 1200
        while proc.poll() is None:
            text = log.read_text(errors='replace')[-14000:]
            bad = re.search(r'read.only file system|no space left|failed.*snapshot|snapshot.*no such file', text, re.I)
            if space() < 6 or bad or time.monotonic() > deadline:
                proc.terminate()
                raise SystemExit(f'STOP {role}: storage/build problem; no retry or repair. See {log}')
            time.sleep(4)
        assert proc.returncode == 0, f'Build failed; see {log}'
    print('BUILT', role, 'FREE_GiB', round(space(), 2), flush=True)
    image = json.loads(run(['image', 'inspect', tag]))[0]
    assert image['Architecture'] == 'arm64'
    check = "const fs=require('fs'),a=require('assert/strict');a(!fs.existsSync('config/wingslab.local.json'));"
    if role == 'backend':
        check += "a(fs.existsSync('packages/backend/dist/services/own-delivery.service.js'));const p=require('./packages/shared/dist/wingslab-order-policy');a(!p.AUTOMATIC_ORDER_DECISIONS_ENABLED);a(p.MANUAL_ORDER_ACTIONS.asumirReparto);"
    else: check += f"a(fs.existsSync('packages/web-{role}/.next/BUILD_ID'));"
    run(['run', '--rm', '--network', 'none', '--read-only', '--entrypoint', 'node', tag, '-e', check])
    envpath = ROOT / 'infrastructure/runtime/runtime.env'
    old_env = envpath.read_text()
    key = f'WINGSLAB_{role.upper()}_IMAGE='
    lines = [l for l in old_env.splitlines() if not l.startswith(key)] + [key + f'wingslab-{role}@' + image['Id']]
    envpath.write_text('\n'.join(lines) + '\n'); envpath.chmod(0o600)
    compose = ['compose', '-p', 'wingslab-2b', '-f', str(ROOT/'infrastructure/runtime/compose.yml'), '--env-file', str(envpath), '--profile', 'approved-2b', '--profile', 'approved-backend', '--profile', 'approved-customer', '--profile', 'approved-restaurant']
    try:
        run(compose + ['config', '--quiet'])
        run(compose + ['up', '-d', '--no-deps', '--pull', 'never', role])
        port = {'backend': 3101, 'restaurant': 3102, 'customer': 3103}[role]
        deadline = time.monotonic() + 30
        while True:
            try:
                with opener.open(f'http://127.0.0.1:{port}/' + ('health' if role == 'backend' else ''), timeout=5) as response:
                    assert response.status == 200
                    if role == 'backend': assert json.load(response)['status'] == 'ok'
                break
            except Exception:
                if time.monotonic() > deadline: raise
                assert inspect(f'wingslab-2b-{role}-1')['State']['Running']
                time.sleep(1)
    except Exception:
        # Restore image pin only for this failed service; never touch data containers.
        envpath.write_text(old_env); envpath.chmod(0o600)
        run(compose + ['up', '-d', '--no-deps', '--pull', 'never', role])
        raise
    print('DEPLOYED', role, image['Id'], flush=True)
for name in ['edge', 'postgres', 'redis']:
    after = inspect(f'wingslab-2b-{name}-1')
    assert (after['Id'], after['State']['StartedAt']) == (before[name]['Id'], before[name]['State']['StartedAt'])
print('DEPLOY_COMPLETE; data/edge untouched; rollback images retained. FREE_GiB', round(space(), 2), flush=True)
