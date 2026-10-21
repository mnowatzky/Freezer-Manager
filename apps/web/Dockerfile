# syntax=docker/dockerfile:1
# Build context: repository root (see docker-compose.yml).

# --- build: static PWA ---------------------------------------------------------------------
# The output is platform-independent, so build natively and copy it into each platform's
# runtime image (no slow emulation for arm64).
FROM --platform=$BUILDPLATFORM node:26-alpine AS build
RUN npm install -g pnpm@12.11.2
WORKDIR /repo
COPY pnpm-workspace.yaml pnpm-lock.yaml package.json tsconfig.base.json ./
COPY packages/shared/package.json packages/shared/
COPY apps/web/package.json apps/web/
RUN pnpm install --frozen-lockfile --filter @freezer/web...
COPY packages/shared packages/shared
COPY apps/web apps/web
# Set by the release workflow; without them the version is "<package.json version>-dev".
ARG APP_VERSION APP_COMMIT
# No domains are baked in: nginx injects ZERO_ORIGIN into index.html at runtime, and QR stickers
# use the page's own origin.
RUN pnpm --filter @freezer/web build

# --- runtime: unprivileged nginx (runs as user nginx, listens on 8080) -----------------------
FROM nginxinc/nginx-unprivileged:1.29-alpine
COPY apps/web/nginx/default.conf.template /etc/nginx/templates/default.conf.template
COPY apps/web/nginx/security-headers.conf /etc/nginx/snippets/security-headers.conf
COPY apps/web/nginx/19-zero-ws-origin.envsh /docker-entrypoint.d/19-zero-ws-origin.envsh
COPY --from=build /repo/apps/web/dist /usr/share/nginx/html
# Public zero-cache origin, used by the app and allowed in the Content-Security-Policy (required at runtime).
ENV ZERO_ORIGIN=""
EXPOSE 8080
HEALTHCHECK --interval=15s --timeout=3s --start-period=5s --retries=3 \
  CMD wget -qO /dev/null http://127.0.0.1:8080/healthz || exit 1
