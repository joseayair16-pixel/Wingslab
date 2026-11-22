#!/usr/bin/env python3
"""Stage one reviewed frontend/shared and SRI-verified packages; never download.

Usage: python3 scripts/wingslab-stage-customer.py NEW_CONTEXT SWC_DOWNLOAD_DIR [customer|restaurant]
"""
import ast
import base64
import hashlib
import json
import os
from pathlib import Path, PurePosixPath
import re
import shutil
import sys
import tarfile

ROOT = Path(__file__).resolve().parent.parent
LOCK = json.loads((ROOT / 'package-lock.json').read_text())['packages']
DEST = Path(sys.argv[1]).resolve()
DOWNLOADS = Path(sys.argv[2]).resolve()
ROLE = sys.argv[3] if len(sys.argv) > 3 else 'customer'
if ROLE not in ['customer', 'restaurant']:
    raise SystemExit('Only reviewed customer/restaurant roles supported')
if DEST.exists():
    raise SystemExit('Destination must be new')

# Reuse reviewed pure lockfile traversal, without executing backend provisioning.
source = ast.parse((ROOT / 'scripts/wingslab-stage-backend.py').read_text())
functions = [n for n in source.body if isinstance(n, ast.FunctionDef) and
             n.name in ['resolve', 'matches', 'visit']]
selected = set()
exec(compile(ast.Module(body=functions, type_ignores=[]), '<locked-traversal>', 'exec'))
for key in [f'packages/web-{ROLE}', 'packages/shared']:
    visit(key)
    for name in LOCK[key].get('devDependencies', {}):
        if name == 'typescript' or name.startswith('@types/') or name in ['autoprefixer', 'postcss']:
            visit(resolve(key, name))

artifacts = {}
for key in sorted(selected):
    entry = LOCK[key]
    if 'integrity' not in entry:
        continue
    algorithm, encoded = entry['integrity'].split('-', 1)
    digest = base64.b64decode(encoded)
    hex_digest = digest.hex()
    cache = Path.home() / '.npm/_cacache/content-v2' / algorithm / hex_digest[:2] / hex_digest[2:4] / hex_digest[4:]
    name = key.rsplit('node_modules/', 1)[-1]
    filename = name.replace('/', '_') + '-' + entry['version'] + '.tgz'
    approved_sharp = Path('/private/var/folders/bp/fw91jby178j6336lpfmmd84m0000gn/T/opencode/wingslab-2c-wad1euux/downloads') / filename
    candidates = [cache, DOWNLOADS / filename, approved_sharp]
    candidate = next((p for p in candidates if p.is_file() and
                      hashlib.new(algorithm, p.read_bytes()).digest() == digest), None)
    if candidate is None:
        raise SystemExit('Missing verified package; stop, do not download: ' + key)
    artifacts[key] = candidate

DEST.mkdir(parents=True)
for key, artifact in artifacts.items():
    target = DEST / key
    target.mkdir(parents=True, exist_ok=True)
    with tarfile.open(artifact, 'r:gz') as archive:
        for member in archive:
            parts = PurePosixPath(member.name).parts
            name = key.rsplit('/', 1)[-1]
            typed_root = ('node_modules/@types/' in key and parts and
                          re.fullmatch(re.escape(name) + r' v\d+(?:\.\d+)*', parts[0]))
            if not parts or (parts[0] not in ['package', name] and not typed_root) or '..' in parts:
                raise ValueError('Unsafe archive member: ' + key)
            relative = Path(*parts[1:])
            if str(relative) == '.':
                continue
            output = target / relative
            if member.isdir():
                output.mkdir(parents=True, exist_ok=True)
            elif member.isfile():
                output.parent.mkdir(parents=True, exist_ok=True)
                with archive.extractfile(member) as src, output.open('wb') as dst:
                    shutil.copyfileobj(src, dst)
                output.chmod(0o755 if member.mode & 0o111 else 0o644)
            else:
                raise ValueError('Archive links/devices forbidden: ' + key)

for name in ['shared', f'web-{ROLE}']:
    link = DEST / 'node_modules/@sadel' / name
    link.parent.mkdir(parents=True, exist_ok=True)
    link.symlink_to('../../packages/' + name)


def copy_file(relative):
    source = ROOT / relative
    if source.is_symlink() or not source.is_file():
        raise ValueError('Not a regular source file: ' + relative)
    output = DEST / relative
    output.parent.mkdir(parents=True, exist_ok=True)
    shutil.copyfile(source, output)


for filename in ['tsconfig.json', 'config/wingslab.cjs', 'scripts/wingslab-run.cjs',
                 'scripts/wingslab-build.cjs', 'scripts/blocked-operation.cjs',
                 'packages/shared/package.json', 'packages/shared/tsconfig.json',
                 'packages/web-customer/package.json', 'packages/web-customer/tsconfig.json',
                 'packages/web-customer/next.config.js', 'packages/web-customer/next-env.d.ts',
                 'packages/web-customer/postcss.config.js', 'packages/web-customer/tailwind.config.ts']:
    copy_file(filename.replace('web-customer', f'web-{ROLE}'))

for relative in ['packages/shared/src', f'packages/web-{ROLE}/src', f'packages/web-{ROLE}/public']:
    for directory, dirs, files in os.walk(ROOT / relative, followlinks=False):
        dirs[:] = [d for d in dirs if not (Path(directory) / d).is_symlink() and
                   d not in ['node_modules', '.next', '.git', 'data']]
        for name in files:
            source = Path(directory) / name
            if (source.is_symlink() or name.startswith('.env') or
                    re.search(r'\.(test|spec)\.|\.bak$|\.map$', name) or
                    re.search(r'firebase-adminsdk|\.(pem|key|p12|jks|dump|apk)$', name, re.I)):
                continue
            if '/src/' in str(source) and source.suffix not in ['.ts', '.tsx', '.js', '.json', '.css', '.png']:
                continue
            copy_file(str(source.relative_to(ROOT)))

(DEST / 'package.json').write_text(json.dumps({'name': f'wingslab-{ROLE}-runtime',
    'private': True, 'workspaces': ['packages/shared', f'packages/web-{ROLE}']}, indent=2) + '\n')
(DEST / 'provision-manifest.json').write_text(json.dumps({
    'platform': 'linux/arm64-musl', 'role': ROLE, 'packages': len(artifacts),
    'lockfileSha256': hashlib.sha256((ROOT / 'package-lock.json').read_bytes()).hexdigest(),
    'packagesByPath': {k: {'version': LOCK[k]['version'], 'integrity': LOCK[k]['integrity']}
                       for k in artifacts}}, indent=2) + '\n')
print('Staged verified packages for', ROLE, ':', len(artifacts))
