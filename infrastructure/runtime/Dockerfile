# syntax=docker/dockerfile:1
# Provision/cache this reviewed image separately in 2B. No network during these RUNs.
ARG WINGSLAB_BUILD_IMAGE
FROM ${WINGSLAB_BUILD_IMAGE} AS build
RUN --network=none test ! -e /app
WORKDIR /app
COPY package.json package-lock.json tsconfig.json ./
COPY packages/shared/package.json packages/shared/package.json
COPY packages/backend/package.json packages/backend/package.json
COPY packages/web-admin/package.json packages/web-admin/package.json
COPY packages/web-customer/package.json packages/web-customer/package.json
COPY packages/web-restaurant/package.json packages/web-restaurant/package.json
COPY packages/web-driver/package.json packages/web-driver/package.json
RUN --network=none npm ci --offline --ignore-scripts --no-audit --no-fund
COPY config ./config
COPY scripts ./scripts
COPY packages/shared/src ./packages/shared/src
COPY packages/shared/tsconfig.json ./packages/shared/tsconfig.json
COPY packages/backend/src ./packages/backend/src
COPY packages/backend/tsconfig.json ./packages/backend/tsconfig.json
COPY packages/backend/jest.hermetic.config.cjs ./packages/backend/jest.hermetic.config.cjs
COPY packages/backend/prisma/schema.prisma ./packages/backend/prisma/schema.prisma
COPY packages/web-admin ./packages/web-admin
COPY packages/web-customer ./packages/web-customer
COPY packages/web-restaurant ./packages/web-restaurant
COPY packages/web-driver ./packages/web-driver
RUN --network=none npm run build -w @sadel/shared
RUN --network=none node node_modules/prisma/build/index.js generate --schema=packages/backend/prisma/schema.prisma
RUN --network=none npm run build -w @sadel/backend
RUN --network=none WINGSLAB_OFFLINE_BUILD=yes node scripts/wingslab-build.cjs admin
RUN --network=none WINGSLAB_OFFLINE_BUILD=yes node scripts/wingslab-build.cjs customer
RUN --network=none WINGSLAB_OFFLINE_BUILD=yes node scripts/wingslab-build.cjs restaurant
RUN --network=none WINGSLAB_OFFLINE_BUILD=yes node scripts/wingslab-build.cjs driver
RUN printf '{"freshBuild":true,"source":"allowlisted-context"}\n' > /app/wingslab-build.json

FROM build AS unit-tests
# Explicit tests only after 2B authorization, with --network=none and a readonly FS.
USER 1000:1000
CMD ["node", "scripts/blocked-operation.cjs"]

FROM ${WINGSLAB_BUILD_IMAGE} AS runtime
WORKDIR /app
COPY --from=build --chown=1000:1000 /app/package.json /app/package-lock.json ./
COPY --from=build --chown=1000:1000 /app/node_modules ./node_modules
COPY --from=build --chown=1000:1000 /app/config ./config
COPY --from=build --chown=1000:1000 /app/scripts ./scripts
COPY --from=build --chown=1000:1000 /app/wingslab-build.json ./wingslab-build.json
COPY --from=build --chown=1000:1000 /app/packages/shared ./packages/shared
COPY --from=build --chown=1000:1000 /app/packages/backend/dist ./packages/backend/dist
COPY --from=build --chown=1000:1000 /app/packages/backend/package.json ./packages/backend/package.json
COPY --from=build --chown=1000:1000 /app/packages/web-admin/.next ./packages/web-admin/.next
COPY --from=build --chown=1000:1000 /app/packages/web-admin/public ./packages/web-admin/public
COPY --from=build --chown=1000:1000 /app/packages/web-admin/next.config.js /app/packages/web-admin/package.json ./packages/web-admin/
COPY --from=build --chown=1000:1000 /app/packages/web-customer/.next ./packages/web-customer/.next
COPY --from=build --chown=1000:1000 /app/packages/web-customer/public ./packages/web-customer/public
COPY --from=build --chown=1000:1000 /app/packages/web-customer/next.config.js /app/packages/web-customer/package.json ./packages/web-customer/
COPY --from=build --chown=1000:1000 /app/packages/web-restaurant/.next ./packages/web-restaurant/.next
COPY --from=build --chown=1000:1000 /app/packages/web-restaurant/public ./packages/web-restaurant/public
COPY --from=build --chown=1000:1000 /app/packages/web-restaurant/next.config.js /app/packages/web-restaurant/package.json ./packages/web-restaurant/
COPY --from=build --chown=1000:1000 /app/packages/web-driver/.next ./packages/web-driver/.next
COPY --from=build --chown=1000:1000 /app/packages/web-driver/public ./packages/web-driver/public
COPY --from=build --chown=1000:1000 /app/packages/web-driver/next.config.js /app/packages/web-driver/package.json ./packages/web-driver/
USER 1000:1000
# No default application starts accidentally; Compose selects one explicit role.
CMD ["node", "scripts/blocked-operation.cjs"]
