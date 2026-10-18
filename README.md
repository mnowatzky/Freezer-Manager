# Freezer Manager

A realtime, multi-user PWA that tracks what's in the home freezer: which food is in which drawer, and in which numbered container (QR stickers). Every change shows up live for everyone who shares the freezer.

| Part | Tech |
| --- | --- |
| `apps/web` | Vite, React, React Router, Tailwind, `vite-plugin-pwa` (installable, offline app shell) |
| `apps/api` | Hono on Node, Better Auth (Pocket ID via generic OIDC), Drizzle + drizzle-kit migrations |
| `packages/shared` | Drizzle schema → generated Zero schema, synced queries, custom mutators, German strings |
| Sync | Rocicorp Zero 1.x (`zero-cache`), Postgres 17 with `wal_level=logical` |
| Auth | Pocket ID (passkeys). No local passwords. |

## How auth and permissions work

1. The browser signs in through Better Auth (`/api/auth/*`) → Pocket ID (OIDC, confidential client + PKCE). The session lives in Postgres and the browser holds a session cookie.
2. The client connects to `zero-cache`. zero-cache forwards the browser's cookies to the API's `/api/zero/query` and `/api/zero/mutate` endpoints, together with a shared `X-Api-Key`.
3. The API validates the session and runs the shared queries and mutators with a trusted `ctx.userID`:
   - **Queries** only return freezers where the user has a `freezer_member` row.
   - **Mutators** check membership, and the owner role where needed, before writing.

   The same mutators also run optimistically on the client. Legacy client-side permissions and CRUD mutators are not used.
4. **New accounts:** Pocket ID only allows signups through single-use links that the API creates. People get one either through an **invite** (they also join that freezer) or, if `REGISTRATION_CODE` is set, by entering that code on the login page under "Noch kein Konto?" (they then set up their own freezer). Wrong codes are rate-limited per IP and globally.
5. Invites need server-only work (random tokens, a Pocket ID signup link created through the Pocket ID admin API), so they use small REST endpoints. The invite rows themselves sync through Zero.

## Prerequisites

- **Node ≥ 24** (tested on Node 26) and **pnpm 12**: `brew install node pnpm`.
- **Docker** (Docker Desktop).

> Node 26 has no prebuilt binary for Zero's native SQLite module. That module is only used by zero-cache, which runs in Docker, so its build is skipped in `pnpm-workspace.yaml` (`allowBuilds`).

## First run (local dev)

```bash
pnpm install
cp .env.example .env
```

1. **Fill in the secrets** in `.env`:
   - `BETTER_AUTH_SECRET` and `POCKET_ID_ENCRYPTION_KEY`: `openssl rand -base64 32`
   - `ZERO_API_KEY`: `openssl rand -hex 32`
   - `ZERO_ADMIN_PASSWORD`: `openssl rand -hex 16`
2. **Start Postgres and Pocket ID:**
   ```bash
   docker compose -f docker-compose.dev.yml up -d postgres pocket-id
   ```
3. **Run migrations.** This creates the tables and the `zero_app` publication that zero-cache replicates.
   ```bash
   pnpm db:migrate
   ```
4. **Set up Pocket ID** at <http://localhost:1411/setup>. Create your admin account and passkey; WebAuthn works on `localhost` without HTTPS. Then:
   - **Administration → OIDC Clients → Add OIDC Client**
     - Name: `Freezer Manager`, client type **Confidential** (the default), callback URL `http://localhost:5173/api/auth/callback/pocket-id`.
     - After **Create**, the client page shows the **Client ID** and **Client secret**. Copy both into `.env` (`POCKET_ID_CLIENT_ID`, `POCKET_ID_CLIENT_SECRET`); the secret is only shown once.
     - On the client page, turn on **PKCE** and save.
     - **Access tab:** select **All Users** and confirm with **Unrestricted**. A new client starts in "Selected user groups" mode with no groups, so nobody could sign in.
   - **Administration → API Keys → Add**, then copy the key into `POCKET_ID_API_KEY`. The API uses it to create signup links for invites. Without a key, invites still work, but only for people who already have a Pocket ID account.
5. **Start zero-cache.** Start it after the migrations, because it needs the publication.
   ```bash
   docker compose -f docker-compose.dev.yml up -d
   ```
6. **Start web and API** with hot reload:
   ```bash
   pnpm dev
   ```
   Open <http://localhost:5173> and sign in with Pocket ID. On first login you set up your freezer (name and number of drawers).
7. **Optional demo data:** after your first login, run
   ```bash
   pnpm db:seed --email you@example.com
   ```
   It adds a freezer "Keller" with 5 drawers and 10 items, owned by that user.

**Testing live sync:** in the app, go to **Einstellungen** (settings) → **Einladung erstellen** (create invite). Open the invite link in a private window. "Neues Konto erstellen" (create new account) registers a second Pocket ID user through a signup link; after that, sign in and join. Changes in one window appear in the other immediately.

### Ports (dev)

| Service | URL |
| --- | --- |
| Web (Vite, proxies `/api` → API) | http://localhost:5173 |
| API | http://localhost:3000 |
| zero-cache | http://localhost:4848 |
| Pocket ID | http://localhost:1411 |
| Postgres | localhost:5432 (`freezer` / `freezer`) |

### Testing on a phone (Tailscale Serve)

Passkeys, the camera and the service worker all need trusted HTTPS, and passkeys need a real hostname, so a plain LAN IP won't work. With Tailscale on the Mac and the phone (with Serve/HTTPS enabled for the tailnet):

```bash
tailscale serve --bg --https=443   http://localhost:5173   # web + /api
tailscale serve --bg --https=8443  http://localhost:4848   # zero-cache (WebSockets)
tailscale serve --bg --https=10000 http://localhost:1411   # Pocket ID
```

1. In `.env`, set:
   - `WEB_ORIGIN=https://<mac>.<tailnet>.ts.net`
   - `POCKET_ID_URL=https://<mac>.<tailnet>.ts.net:10000`
   - `POCKET_ID_TRUST_PROXY=true`
   - `POCKET_ID_INTERNAL_URL=http://localhost:1411`
   - `VITE_ZERO_CACHE_URL=https://<mac>.<tailnet>.ts.net:8443`
2. Add `https://<mac>.<tailnet>.ts.net/api/auth/callback/pocket-id` to the OIDC client.
3. Run `docker compose -f docker-compose.dev.yml up -d pocket-id`, then restart `pnpm dev`.

Passkeys are tied to the domain, so register a new one at the ts.net address. If you can't log in there yet, create a login link with `docker exec freezer-dev-pocket-id-1 /app/pocket-id one-time-access-token <username>`.

## Scripts

| Command | What it does |
| --- | --- |
| `pnpm dev` | web + API with hot reload |
| `pnpm test` | all tests (Vitest, against PGlite): mutators, read permissions of the Zero queries, invite REST endpoints, CSRF |
| `pnpm typecheck` | TypeScript across all packages |
| `pnpm lint` | Oxlint, type-aware (floating promises, React hooks rules, a11y, …); config in `.oxlintrc.json` |
| `pnpm build` | production builds: web app (`apps/web/dist`) and the bundled API (`apps/api/dist/*.mjs`) |
| `pnpm db:generate` | new Drizzle migration from `packages/shared/src/db-schema.ts` |
| `pnpm db:migrate` | apply migrations |
| `pnpm db:seed --email …` | demo data |
| `pnpm zero:generate` | regenerate `zero-schema.gen.ts` from the Drizzle schema |

**Changing the schema:**
1. Edit `packages/shared/src/db-schema.ts`.
2. Run `pnpm db:generate && pnpm zero:generate && pnpm db:migrate`.
3. New tables must also be added to the publication, in a custom migration: `ALTER PUBLICATION zero_app ADD TABLE …`. Generate it with `pnpm --filter @freezer/api exec drizzle-kit generate --custom`.

## QR stickers and scanning

- A container sticker encodes `https://freezer.malte-nowatzky.de/c/<number>`. The phone camera opens the app directly:
  - If the container is empty, you get **Einfrieren** (freeze) with the number filled in.
  - If it holds something, you see the item with **Entnehmen…** (take out).
- Numbers are unique per freezer, and containers don't need to be registered.
- **Einstellungen → QR-Etiketten drucken** (`/etiketten?von=1&bis=40`) prints a sticker sheet. The URL origin comes from `VITE_PUBLIC_URL`.
- The in-app **Scannen** (scan) button uses the camera through a bundled ZXing WASM build, which also works on iOS. You can also type the number.

## Design (Material 3 Expressive)

The UI follows [Material 3 Expressive](https://m3.material.io/). Material Web (`@material/web`) is in maintenance mode and has no Expressive components, so the app has small components of its own in `apps/web/src/components/m3/`, built on the official tokens:

- **Color:**
  - `src/theme/colors.gen.css` holds the M3 color roles (light and dark), generated from the brand seed `#35A9B5` with `@material/material-color-utilities`, using SchemeTonalSpot and the 2025 spec.
  - To regenerate it, run `pnpm --filter @freezer/web generate-theme`.
  - Tailwind exposes the roles as utilities, such as `bg-primary-container` and `text-on-surface-variant`.
- **Shape and type:** `src/theme/tokens.css` holds the corner scale (including the Expressive `*-increased` steps) and the M3 type scale in Google Sans Flex. Use the `type-*` and `type-emphasized` utilities.
- **Motion:**
  - `src/theme/motion.ts` turns the Expressive spring tokens (fast/default/slow × spatial/effects) into Motion springs.
  - Pressed controls morph their shape.
  - Lists, sheets, FABs and the app bar animate on these springs.
  - The OS "reduce motion" setting is respected.
- **Icons:**
  - The icons are Material Symbols Rounded as a self-hosted variable-font subset (`public/fonts/`), which works offline and animates the fill on selection.
  - To add an icon, put its name into `src/theme/icon-names.txt` and run `pnpm --filter @freezer/web fetch-icons`.

- **App icons:** `pnpm --filter @freezer/web generate-icons` renders `apps/web/assets/icon*.svg` (the 108-unit adaptive-icon artwork) into four kinds of icon:
  - a round `any` icon, for browsers that create plain shortcuts (e.g. Brave)
  - a padded `maskable` icon, for Android launcher shapes
  - a `monochrome` icon, for Android themed icons
  - the Apple touch icon and favicon

  Installing from Chrome on Android creates a real WebAPK, which uses the maskable and monochrome icons.

## Production

`docker-compose.yml` runs **postgres, migrate (one-off), api, zero-cache and web**. Login uses an **existing Pocket ID instance** (`POCKET_ID_URL`); a bundled Pocket ID is available as an optional profile (see below). Nothing publishes ports. Your existing **nginx proxy manager** (NPM) handles TLS and reaches the services over the shared external Docker network.

**Images:**
- **`api`:** the API is bundled with esbuild into `dist/index.mjs` and `dist/migrate.mjs`, including all npm dependencies. The runtime image only has Node, the bundle and `drizzle/` (the migration SQL), and runs as the unprivileged `node` user. Node is the main process and shuts down gracefully on `SIGTERM`.
- **`web`:** the static PWA on unprivileged nginx (port **8080**), with gzip and caching rules. Security headers include a strict Content-Security-Policy; its `connect-src` gets the zero-cache origin from `ZERO_ORIGIN` at container start.
- Both are built locally (for the VPS's CPU architecture) and pushed to Docker Hub as `${IMAGE_REPO}:api-<tag>` and `${IMAGE_REPO}:web-<tag>` (default `maltenow/freezer-manager`). The VPS only needs `docker-compose.yml` and `.env`; it pulls the images.
- Both images have a `HEALTHCHECK`; postgres and zero-cache have healthchecks in the compose file.

**Startup order:** postgres (healthy) → `migrate` applies pending migrations and exits → api (healthy) → zero-cache. A failed migration stops the deploy before the new API starts.

### Pocket ID (existing instance)

In your Pocket ID (it must be reachable from the internet, by phones and by the VPS):
1. **Signups:** Administration → Application Configuration → User Creation → **"Signup with token"** (or `ALLOW_USER_SIGNUPS=withToken`). Invites then come with a signup link for people without an account; open self-registration stays off.
2. **Group:** create a group such as `freezer` and copy its ID. Put it into `POCKET_ID_SIGNUP_GROUP_IDS`, so people who sign up via an invite land in that group only. Restrict your other apps' OIDC clients to your own groups, otherwise invitees could sign in there too.
3. **OIDC client:** Administration → OIDC Clients → Add: name `Freezer Manager`, **Confidential**, callback `https://freezer.malte-nowatzky.de/api/auth/callback/pocket-id`. Copy client ID and secret (shown once). Turn on **PKCE**. **Access tab:** "All Users" (confirm "Unrestricted"), or your own group plus `freezer`.
4. **API key:** Administration → API Keys → Add (the API creates signup links with it).
5. **Registration code (optional):** set `REGISTRATION_CODE` in the VPS `.env` to let people without an invite create an account on the login page. Hand the code out personally; anyone who has it can register.

### VPS setup

1. **Docker network:** check NPM's network (`docker network ls`). Set it as `PROXY_NETWORK` (default `npm_proxy`), or create it (`docker network create npm_proxy`) and attach NPM (`docker network connect npm_proxy <npm-container>`).
2. **Files:** put `docker-compose.yml` and a `.env` (mode 600) into e.g. `/opt/freezer`. `.env` needs `IMAGE_TAG`, `POSTGRES_PASSWORD`, `BETTER_AUTH_SECRET`, `ZERO_API_KEY`, `ZERO_ADMIN_PASSWORD`, `POCKET_ID_URL`, `POCKET_ID_CLIENT_ID`, `POCKET_ID_CLIENT_SECRET`, `POCKET_ID_API_KEY` and optionally `POCKET_ID_SIGNUP_GROUP_IDS` and `REGISTRATION_CODE` (see `.env.example`). Hostnames default to the values below; override with `FREEZER_HOST` and `SYNC_HOST`. Keep a copy of `.env` somewhere safe.
3. **Start the stack before creating proxy hosts.** NPM's nginx resolves the forward hostnames when it loads its config; if the containers don't exist yet, NPM fails with "Internal Error".
   ```bash
   docker compose pull
   docker compose up -d --no-build
   docker compose ps     # all healthy, migrate "Exited (0)"
   docker exec <npm-container> getent hosts freezer-web freezer-api freezer-zero   # NPM must resolve them
   ```
4. **DNS and proxy hosts** (SSL with Force SSL and HSTS):

   | Hostname | Forward to | Notes |
   | --- | --- | --- |
   | `freezer.malte-nowatzky.de` | `freezer-web` : `8080` | **Custom location** `/api` → `freezer-api` : `3000` (hostname only, no path) |
   | `sync.freezer.malte-nowatzky.de` | `freezer-zero` : `4848` | **Enable "Websockets Support"** (required) |

   **With Cloudflare:** request the certificates with NPM's **DNS challenge** (provider Cloudflare, API token with "Edit zone DNS"), and set SSL/TLS to **Full (strict)**. `sync.freezer.…` is two levels deep, which Cloudflare's free edge certificate does not cover: set that record to **DNS only** (grey cloud). The name must stay under `freezer.…`, because the session cookie for that domain has to reach zero-cache.
5. **Check:** `curl https://freezer.malte-nowatzky.de/api/health` → `{"ok":true}`, then sign in and install the PWA (Chrome → "Install app").

**Deploying an update:** push new images with a new tag, set `IMAGE_TAG` in the VPS `.env`, then `docker compose pull && docker compose up -d --no-build`. `migrate` runs again first; migrations that already ran are skipped. **Rollback:** set the previous `IMAGE_TAG` and run the same commands. Schema migrations are not reverted, so only roll back across releases without migrations, or restore the database backup.

### Optional: bundled Pocket ID

To run Pocket ID inside this stack instead: set `COMPOSE_PROFILES=bundled-pocket-id`, `POCKET_ID_URL=https://<its hostname>`, `POCKET_ID_INTERNAL_URL=http://pocket-id:1411` and `POCKET_ID_ENCRYPTION_KEY` (`openssl rand -base64 32`) in `.env`; add an NPM proxy host `<its hostname>` → `freezer-pocket-id` : `1411`; then set it up at `https://<its hostname>/setup` as above. Its data lives in the `pocket-id-data` volume; losing `POCKET_ID_ENCRYPTION_KEY` makes it unusable.

Notes:
- The session cookie is set for `freezer.malte-nowatzky.de` (`COOKIE_DOMAIN`), so the browser also sends it to `sync.freezer.malte-nowatzky.de`, and zero-cache forwards it to the API.
- Logins depend on Pocket ID being reachable; existing sessions last 30 days, and sync/editing work without it.
- Logs: the API writes one JSON object per line (`docker compose logs api`). Unhandled API errors and browser errors (sent by the PWA to `/api/client-errors`, size- and rate-limited) appear as `"level":"error"` lines.
- CSRF: the API rejects state-changing requests to its own endpoints unless they come from the web app's origin. `/api/auth` is checked by Better Auth itself, and `/api/zero` by the zero-cache API key.
- `VITE_ZERO_CACHE_URL` and `VITE_PUBLIC_URL` are baked in at image build time (see the `web` build args). `ZERO_ORIGIN` (for the CSP) is set at runtime.

## Limitations

- **No offline writes.** Zero shows cached data offline, but rejects writes. The app shows an "Offline" banner and disables buttons that change data.
- **Navigation bar color.** On Android 15+ an installed app's gesture/navigation bar shows the manifest `background_color`. A manifest has only one value, with no dark variant, so it's set to the dark surface: in dark mode the bar matches, in light mode it is dark. `theme_color` is left out on purpose (see the comment in `apps/web/vite.config.ts`).
