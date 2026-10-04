# Midas MCP server (Streamable HTTP) for Fly.io — remote connector transport.
# Build from repo root: fly deploy --config apps/mcp/fly.toml

FROM node:22-slim AS build
WORKDIR /repo
RUN corepack enable && corepack prepare pnpm@9.15.9 --activate
COPY package.json pnpm-workspace.yaml pnpm-lock.yaml* tsconfig.base.json ./
COPY packages/analysis/package.json packages/analysis/
COPY apps/mcp/package.json apps/mcp/
RUN pnpm install --filter @midas/mcp...
COPY packages/analysis packages/analysis
COPY apps/mcp apps/mcp
RUN pnpm --filter @midas/analysis build && pnpm --filter @midas/mcp build
RUN pnpm --filter @midas/mcp... deploy --prod /app

FROM node:22-slim AS runtime
WORKDIR /app
ENV NODE_ENV=production PORT=8080
COPY --from=build /app /app
COPY --from=build /repo/apps/mcp/dist /app/dist
RUN groupadd -r midas && useradd -r -g midas midas \
  && mkdir -p /data && chown -R midas:midas /data /app
USER midas
ENV MIDAS_DATA_DIR=/data
EXPOSE 8080
CMD ["node", "dist/http.js"]
