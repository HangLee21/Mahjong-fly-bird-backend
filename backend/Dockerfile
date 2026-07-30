ARG NODE_BASE_IMAGE=node:20-bookworm-slim
FROM ${NODE_BASE_IMAGE} AS base

# Prisma detects the OpenSSL ABI at runtime before loading its native engines.
RUN apt-get update \
    && apt-get install -y --no-install-recommends ca-certificates openssl \
    && rm -rf /var/lib/apt/lists/*

FROM base AS build

ARG NPM_CONFIG_REGISTRY=https://registry.npmjs.org
ARG PRISMA_ENGINES_MIRROR=https://binaries.prisma.sh

WORKDIR /app

COPY backend/package.json backend/package-lock.json ./
RUN --mount=type=cache,target=/root/.npm \
    --mount=type=cache,target=/root/.cache/prisma \
    CACHE_DIR=/root/.cache \
    npm ci --prefer-offline --no-audit --no-fund

COPY backend/prisma ./prisma
RUN --mount=type=cache,target=/root/.cache/prisma \
    CACHE_DIR=/root/.cache \
    npx prisma generate

COPY backend/tsconfig.json ./
COPY backend/src ./src
COPY backend/scripts ./scripts
RUN npm run build \
    && npm prune --omit=dev

FROM base AS runtime

ENV NODE_ENV=production
WORKDIR /app

COPY --from=build --chown=node:node /app/package.json ./package.json
COPY --from=build --chown=node:node /app/node_modules ./node_modules
COPY --from=build --chown=node:node /app/dist ./dist
COPY --from=build --chown=node:node /app/prisma ./prisma
COPY --chown=node:node backend/docker-entrypoint.sh /usr/local/bin/mahjong-entrypoint

RUN chmod +x /usr/local/bin/mahjong-entrypoint

USER node
EXPOSE 3000

ENTRYPOINT ["mahjong-entrypoint"]
CMD ["node", "dist/src/main.js"]
