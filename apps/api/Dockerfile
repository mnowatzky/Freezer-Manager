# Build context: repository root (see docker-compose.yml)
FROM node:26-alpine
RUN npm install -g pnpm@12.11.2
WORKDIR /app
COPY pnpm-workspace.yaml pnpm-lock.yaml package.json tsconfig.base.json ./
COPY packages/shared/package.json packages/shared/
COPY apps/api/package.json apps/api/
RUN pnpm install --frozen-lockfile --filter @freezer/api... --prod
COPY packages/shared packages/shared
COPY apps/api apps/api
WORKDIR /app/apps/api
ENV NODE_ENV=production
EXPOSE 3000
# Applies pending migrations, then starts the API.
CMD ["pnpm", "start"]
