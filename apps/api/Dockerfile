# Midas API — long-lived Node service for Fly.io
# Build from the repo root: fly deploy --config apps/api/fly.toml --dockerfile apps/api/Dockerfile

FROM node:22-slim AS build
WORKDIR /repo
RUN corepack enable && corepack prepare pnpm@9.15.9 --activate

# Workspace manifests first for layer caching
COPY package.json pnpm-workspace.yaml pnpm-lock.yaml* tsconfig.base.json ./
COPY packages/shared/package.json packages/shared/
COPY apps/api/package.json apps/api/
RUN pnpm install --frozen-lockfile --filter @midas/api... 2>/dev/null || pnpm install --filter @midas/api...

# Source + build
COPY packages/shared packages/shared
COPY apps/api apps/api
COPY db db
RUN pnpm --filter @midas/shared build && pnpm --filter @midas/api build

# Prune to production deps
RUN pnpm --filter @midas/api... deploy --prod /app

FROM node:22-slim AS runtime
WORKDIR /app
ENV NODE_ENV=production
COPY --from=build /app /app
COPY --from=build /repo/apps/api/dist /app/dist
COPY --from=build /repo/db/migrations /app/db/migrations
ENV MIGRATIONS_DIR=/app/db/migrations

# Non-root user (least privilege)
RUN groupadd -r midas && useradd -r -g midas midas \
  && mkdir -p /data/uploads && chown -R midas:midas /data /app
USER midas

EXPOSE 3001
CMD ["node", "dist/index.js"]
