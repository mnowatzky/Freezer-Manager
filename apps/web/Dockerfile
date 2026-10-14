# Build context: repository root (see docker-compose.yml)
FROM node:26-alpine AS build
RUN npm install -g pnpm@12.11.2
WORKDIR /app
COPY pnpm-workspace.yaml pnpm-lock.yaml package.json tsconfig.base.json ./
COPY packages/shared/package.json packages/shared/
COPY apps/web/package.json apps/web/
RUN pnpm install --frozen-lockfile --filter @freezer/web...
COPY packages/shared packages/shared
COPY apps/web apps/web
ARG VITE_ZERO_CACHE_URL
ARG VITE_PUBLIC_URL
ENV VITE_ZERO_CACHE_URL=$VITE_ZERO_CACHE_URL VITE_PUBLIC_URL=$VITE_PUBLIC_URL
RUN pnpm --filter @freezer/web build

FROM nginx:1.29-alpine
COPY apps/web/nginx.conf /etc/nginx/conf.d/default.conf
COPY --from=build /app/apps/web/dist /usr/share/nginx/html
EXPOSE 80
