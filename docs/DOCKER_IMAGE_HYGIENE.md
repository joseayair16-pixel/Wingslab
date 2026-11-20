# WingsLab Docker image hygiene

Compose does not delete an old image when a service is redeployed. New builds
should use versioned tags/digests so rollback remains possible; these are separate
build snapshots, not necessarily byte-for-byte duplicate images. Their unshared
layers accumulate unless obsolete tags are pruned explicitly.

After building and deploying an application image, first check the deployment
and its health. Review the default dry run, then apply only if its candidate list
contains no image that still needs to be retained:

```sh
python3 scripts/wingslab-prune-app-images.py
python3 scripts/wingslab-prune-app-images.py --apply
```

The default is a dry run and keeps the newest unpinned image per app repository
as a rollback candidate. `--apply` removes only older unpinned tags from the four
WingsLab application repositories (customer, restaurant, driver, backend). It
protects images referenced by any container, including stopped containers, and
the image digests pinned in `infrastructure/runtime/runtime.env`. To remove all
unpinned images after explicitly deciding rollback is unnecessary, pass
`--keep-unpinned 0` to both commands.

The helper never removes containers, volumes, databases, other projects' images,
or build cache. Image cleanup is deliberately not automatic: promote and health-
check a build first, then inspect the dry-run output. Source files remain in the
repository; image tags are built artifacts and can be rebuilt from the reviewed
source and lockfile.
