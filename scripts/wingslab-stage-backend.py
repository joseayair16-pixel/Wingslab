#!/usr/bin/env python3
"""Stage a backend-only build from SRI-verified tarballs. Never fetch or install.

Usage: python3 scripts/wingslab-stage-backend.py NEW_CONTEXT APPROVED_DOWNLOADS
The destination must not exist. No project code or package lifecycle script runs.
"""
import base64
import hashlib
import json
import os
import re
from pathlib import Path, PurePosixPath
import shutil
import sys
import tarfile

ROOT = Path(__file__).resolve().parent.parent
LOCK = json.loads((ROOT / 'package-lock.json').read_text())['packages']
DEST = Path(sys.argv[1]).resolve()
DOWNLOADS = Path(sys.argv[2]).resolve()
if DEST.exists():
    raise SystemExit('Refusing to overwrite an existing context')


def resolve(source, name):
    parent = PurePosixPath(source)
    while True:
        key = str(parent / 'node_modules' / name)
        if key in LOCK:
            return key
        if str(parent) == '.':
            raise ValueError('Unresolved locked dependency: ' + name)
        parent = parent.parent


def matches(values, target):
    if not values:
        return True
    positives = [v for v in values if not v.startswith('!')]
    return '!' + target not in values and (not positives or target in positives)


selected = set()


def visit(key):
    if key in selected:
        return
    selected.add(key)
    record = LOCK[key]
    for name in {**record.get('dependencies', {}), **record.get('optionalDependencies', {})}:
        try:
            child = resolve(key, name)
        except ValueError:
            if name in record.get('optionalDependencies', {}):
                continue
            raise
        entry = LOCK[child]
        if not all(matches(entry.get(field), value) for field, value in
                   [('os', 'linux'), ('cpu', 'arm64'), ('libc', 'musl')]):
            continue
        visit(entry['resolved'] if entry.get('link') else child)


visit('packages/backend')
visit('packages/shared')
production = set(selected)
for name in LOCK['packages/backend']['devDependencies']:
    # tsx/esbuild is not used: compile with tsc and test with ts-jest.
    if name != 'tsx':
        visit(resolve('packages/backend', name))

artifacts = {}
for key in sorted(selected):
    entry = LOCK[key]
    if 'integrity' not in entry:
        continue
    algorithm, encoded = entry['integrity'].split('-', 1)
    digest = base64.b64decode(encoded)
    hex_digest = digest.hex()
    cached = Path.home() / '.npm/_cacache/content-v2' / algorithm / hex_digest[:2] / hex_digest[2:4] / hex_digest[4:]
    name = entry.get('name') or key.rsplit('node_modules/', 1)[1]
    approved = DOWNLOADS / (name.replace('/', '_') + '-' + entry['version'] + '.tgz')
    candidate = cached if cached.is_file() else approved
    if not candidate.is_file():
        raise SystemExit('Missing artifact; no downloads permitted by this script: ' + key)
    if hashlib.new(algorithm, candidate.read_bytes()).digest() != digest:
        raise SystemExit('Integrity mismatch: ' + key)
    artifacts[key] = candidate

DEST.mkdir(parents=True)
for key, artifact in artifacts.items():
    target = DEST / key
    target.mkdir(parents=True, exist_ok=True)
    with tarfile.open(artifact, 'r:gz') as archive:
        for member in archive:
            parts = PurePosixPath(member.name).parts
            # DefinitelyTyped publishes a package-name root rather than package/.
            roots = ['package', key.rsplit('/', 1)[-1]]
            typed_root = ('node_modules/@types/' in key and parts and
                          re.fullmatch(re.escape(roots[1]) + r' v\d+(?:\.\d+)*', parts[0]))
            if not parts or (parts[0] not in roots and not typed_root) or '..' in parts:
                raise ValueError('Unexpected tar member: ' + key)
            relative = Path(*parts[1:])
            if str(relative) == '.':
                continue
            output = target / relative
            # No package archive can create a symlink, device or hardlink.
            if member.isdir():
                output.mkdir(parents=True, exist_ok=True)
            elif member.isfile():
                output.parent.mkdir(parents=True, exist_ok=True)
                with archive.extractfile(member) as src, output.open('wb') as dst:
                    shutil.copyfileobj(src, dst)
                output.chmod(0o755 if member.mode & 0o111 else 0o644)
            else:
                raise ValueError('Non-regular archive member: ' + key)

# Workspace resolution only for these two reviewed packages.
for name in ['backend', 'shared']:
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


for relative in ['package.json', 'package-lock.json', 'tsconfig.json',
                 'config/wingslab.cjs', 'scripts/wingslab-run.cjs',
                 'scripts/blocked-operation.cjs', 'packages/backend/package.json',
                 'packages/backend/tsconfig.json', 'packages/backend/jest.hermetic.config.cjs',
                 'packages/backend/prisma/schema.prisma', 'packages/shared/package.json',
                 'packages/shared/tsconfig.json']:
    copy_file(relative)

for package in ['backend', 'shared']:
    source_root = ROOT / 'packages' / package / 'src'
    for directory, dirs, files in os.walk(source_root, followlinks=False):
        dirs[:] = [d for d in dirs if d not in ['scripts', 'data'] and
                   not (Path(directory) / d).is_symlink()]
        for name in files:
            source = Path(directory) / name
            if (source.is_symlink() or source.suffix not in ['.ts', '.js', '.json'] or
                    name.startswith(('.env', 'check_transfer_db')) or name == 'test-setup.ts' or
                    'firebase-adminsdk' in name.lower() or
                    (('.test.' in name or '.spec.' in name) and not name.endswith('.unit.test.ts'))):
                continue
            copy_file(str(source.relative_to(ROOT)))

# Root package.json is metadata only: avoid inherited lifecycle/workspace commands.
root_metadata = {'name': 'wingslab-backend-runtime', 'private': True,
                 'workspaces': ['packages/backend', 'packages/shared']}
(DEST / 'package.json').write_text(json.dumps(root_metadata, indent=2) + '\n')
engines = DEST / 'node_modules/@prisma/engines'
for source, filename in [('libquery_engine.so.node', 'libquery_engine-linux-musl-arm64-openssl-3.0.x.so.node'),
                         ('schema-engine', 'schema-engine-linux-musl-arm64-openssl-3.0.x')]:
    shutil.copyfile(DOWNLOADS / source, engines / filename)
    (engines / filename).chmod(0o755)

# Materialize a production-only dependency tree for the final image, without npm.
prod = DEST / 'production-deps'
for key in sorted(production):
    if key not in artifacts:
        continue
    source = DEST / key
    # Nested locked packages are copied separately, not recursively via parents.
    shutil.copytree(source, prod / key, copy_function=os.link, dirs_exist_ok=True,
                    ignore=lambda directory, names: ['node_modules'] if Path(directory) == source else [])
for name in ['backend', 'shared']:
    link = prod / 'node_modules/@sadel' / name
    link.parent.mkdir(parents=True, exist_ok=True)
    link.symlink_to('../../packages/' + name)

manifest = {'platform': 'linux/arm64-musl', 'packages': len(artifacts),
            'productionPackages': len([k for k in production if k in artifacts]),
            'lockfileSha256': hashlib.sha256((ROOT / 'package-lock.json').read_bytes()).hexdigest(),
            'packagesByPath': {key: {'version': LOCK[key]['version'], 'integrity': LOCK[key]['integrity']}
                               for key in artifacts}}
(DEST / 'provision-manifest.json').write_text(json.dumps(manifest, indent=2) + '\n')
print(json.dumps({k: v for k, v in manifest.items() if k != 'packagesByPath'}))
