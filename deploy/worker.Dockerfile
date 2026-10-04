FROM node:24-bookworm-slim
WORKDIR /app
RUN corepack enable && corepack prepare pnpm@9.15.9 --activate
COPY . .
RUN pnpm install --frozen-lockfile
WORKDIR /app/apps/web
CMD ["node", "--require", "./scripts/register-typescript.cjs", "scripts/worker.cjs"]
