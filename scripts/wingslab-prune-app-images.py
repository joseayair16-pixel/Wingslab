#!/usr/bin/env python3
"""Report/remove obsolete WingsLab app image tags, preserving running and pinned images.

Dry-run by default. Pass --apply to remove tags from the four application
repositories only; never removes image IDs directly, containers, volumes, or cache.
By default, also retain the newest unpinned image per app repository as a rollback
candidate. Set --keep-unpinned 0 only when that rollback image is no longer needed.
"""
import argparse
import json
import re
import subprocess
import sys
from pathlib import Path


DOCKER = ["docker", "--context", "desktop-linux"]
APP_REPOS = {
    "wingslab-customer": "WINGSLAB_CUSTOMER_IMAGE",
    "wingslab-restaurant": "WINGSLAB_RESTAURANT_IMAGE",
    "wingslab-driver": "WINGSLAB_DRIVER_IMAGE",
    "wingslab-backend": "WINGSLAB_BACKEND_IMAGE",
}
RUNTIME_ENV = Path(__file__).resolve().parents[1] / "infrastructure/runtime/runtime.env"


def docker(*args):
    result = subprocess.run(DOCKER + list(args), text=True, capture_output=True)
    if result.returncode:
        raise RuntimeError(result.stderr.strip() or f"docker {' '.join(args)} failed")
    return result.stdout


def select_obsolete_rows(rows, protected_ids, keep_unpinned):
    """Select old unpinned app tags while retaining N newest image IDs per repo."""
    candidates = []
    for repository in APP_REPOS:
        eligible = [row for row in rows
                    if row.get("Repository") == repository and row["ID"] not in protected_ids]
        newest_by_id = {}
        for row in eligible:
            image_id = row["ID"]
            newest_by_id[image_id] = max(
                newest_by_id.get(image_id, ""), row.get("CreatedAt", "")
            )
        retained_ids = {
            image_id for image_id, _ in sorted(
                newest_by_id.items(), key=lambda pair: pair[1], reverse=True
            )[:keep_unpinned]
        }
        candidates.extend(row for row in eligible if row["ID"] not in retained_ids)
    return candidates


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--apply", action="store_true", help="actually remove obsolete app tags")
    parser.add_argument(
        "--keep-unpinned", type=int, default=1, metavar="N",
        help="retain the N newest unpinned images per app repository (default: 1)",
    )
    args = parser.parse_args()
    if args.keep_unpinned < 0:
        parser.error("--keep-unpinned must be zero or greater")

    env = {}
    for line in RUNTIME_ENV.read_text().splitlines():
        match = re.match(r"\s*(WINGSLAB_[A-Z_]+)=(.*?)\s*$", line)
        if match:
            env[match.group(1)] = match.group(2)

    rows = [json.loads(line) for line in docker(
        "image", "ls", "--all", "--no-trunc", "--format", "{{json .}}"
    ).splitlines() if line.strip()]
    protected_ids = set()

    # Any image used by any container (running or stopped) is protected.
    for container_id in docker("ps", "-aq").split():
        item = json.loads(docker("inspect", container_id))[0]
        protected_ids.add(item["Image"])

    # Also protect the images Compose is pinned to, even before they are running.
    for variable in APP_REPOS.values():
        reference = env.get(variable, "")
        if not reference:
            raise RuntimeError(f"Missing {variable} in {RUNTIME_ENV}")
        result = subprocess.run(DOCKER + ["image", "inspect", reference], text=True, capture_output=True)
        if result.returncode:
            raise RuntimeError(f"Pinned image for {variable} is unavailable: {reference}")
        protected_ids.add(json.loads(result.stdout)[0]["Id"])

    # Keep a small rollback window, ranked by image creation time. Group by ID
    # so multiple aliases of one image do not consume multiple retention slots.
    candidates = select_obsolete_rows(rows, protected_ids, args.keep_unpinned)
    # Validate candidates are not referenced by any container before doing anything destructive.
    if any(row["ID"] in protected_ids for row in candidates):
        raise RuntimeError("Safety check failed: a candidate image is protected")

    action = "would remove" if not args.apply else "removed"
    print(f"{action} {len(candidates)} obsolete WingsLab app image tag(s):")
    for row in candidates:
        reference = f"{row['Repository']}:{row['Tag']}"
        print(f"  {reference} ({row['ID'][:19]})")
        if args.apply:
            docker("image", "rm", reference)
    if not args.apply:
        print(f"Dry run only. Retaining up to {args.keep_unpinned} unpinned rollback image(s) per app.")
        print("Pass --apply after deployment/health checks to remove listed tags.")


if __name__ == "__main__":
    try:
        main()
    except (OSError, RuntimeError, subprocess.CalledProcessError) as error:
        print(f"ERROR: {error}", file=sys.stderr)
        sys.exit(1)
