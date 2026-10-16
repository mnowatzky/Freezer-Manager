# syntax=docker/dockerfile:1
# Build context: repository root (see docker-compose.yml).

# --- build: bundle the API (incl. all dependencies) into dist/*.mjs -------------------------
FROM node:26-alpine AS build
RUN npm install -g pnpm@12.11.2
WORKDIR /repo
COPY pnpm-workspace.yaml pnpm-lock.yaml package.json tsconfig.base.json ./
COPY packages/shared/package.json packages/shared/
COPY apps/api/package.json apps/api/
RUN pnpm install --frozen-lockfile --filter @freezer/api...
COPY packages/shared packages/shared
COPY apps/api apps/api
RUN pnpm --filter @freezer/api build

# --- runtime: just Node, the bundle and the migration SQL; runs as the unprivileged `node` user
FROM node:26-alpine
ENV NODE_ENV=production
WORKDIR /app
COPY --from=build /repo/apps/api/dist ./dist
COPY --from=build /repo/apps/api/drizzle ./drizzle
USER node
EXPOSE 3000
HEALTHCHECK --interval=15s --timeout=3s --start-period=10s --retries=3 \
  CMD wget -qO /dev/null http://127.0.0.1:3000/api/health || exit 1
# Node is PID 1 and handles SIGTERM itself (graceful shutdown in src/index.ts).
# Migrations run separately: `node dist/migrate.mjs` (the `migrate` service in docker-compose.yml).
CMD ["node", "--enable-source-maps", "dist/index.mjs"]
