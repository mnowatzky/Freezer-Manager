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
4. Invites need server-only work (random tokens, a Pocket ID signup link created through the Pocket ID admin API), so they use small REST endpoints. The invite rows themselves sync through Zero.

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
     - Name: `Freezer Manager`
     - Callback URL: `http://localhost:5173/api/auth/callback/pocket-id`
     - Leave **Public client** off (confidential) and turn **PKCE** on.
     - Save, then copy the **Client ID** and **Client secret** into `.env` (`POCKET_ID_CLIENT_ID`, `POCKET_ID_CLIENT_SECRET`). The secret is only shown once.
     - Leave access unrestricted (no user groups), so every Pocket ID user may sign in.
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
| `pnpm test` | mutator and permission tests (Vitest, against PGlite) |
| `pnpm typecheck` | TypeScript across all packages |
| `pnpm build` | production build of the web app |
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

## Production (prepared, not deployed)

`docker-compose.yml` runs **postgres, zero-cache, api, web** (static build served by nginx) and **pocket-id**. Nothing publishes ports. Your existing **nginx proxy manager** handles TLS and reaches the services over the shared external Docker network.

1. **On the VPS**, check the name of NPM's Docker network (`docker network ls`). Set it as `PROXY_NETWORK` (default `npm_proxy`), or create it with `docker network create npm_proxy` and attach NPM to it.
2. **Create a `.env`** next to `docker-compose.yml` with:
   - `POSTGRES_PASSWORD`
   - `BETTER_AUTH_SECRET`
   - `POCKET_ID_ENCRYPTION_KEY`
   - `ZERO_API_KEY`
   - `ZERO_ADMIN_PASSWORD`

   Hostnames default to the values below; override them with `FREEZER_HOST`, `SYNC_HOST` and `POCKET_ID_HOST`.
3. **Create DNS records** for the three hostnames.
4. **Add NPM proxy hosts**, all with SSL (Let's Encrypt) and Force SSL:

   | Hostname | Forward to | Notes |
   | --- | --- | --- |
   | `freezer.malte-nowatzky.de` | `freezer-web` : `80` | **Custom location** `/api` → `freezer-api` : `3000` |
   | `sync.freezer.malte-nowatzky.de` | `freezer-zero` : `4848` | **Enable "Websockets Support"** (required) |
   | `id.malte-nowatzky.de` | `freezer-pocket-id` : `1411` | |

5. **First start:**
   ```bash
   docker compose up -d --build
   ```
   The API applies migrations on start; zero-cache restarts (restart policy) until the publication exists.
6. **Set up Pocket ID** at `https://id.malte-nowatzky.de/setup`, the same way as in dev, with:
   - Callback URL: `https://freezer.malte-nowatzky.de/api/auth/callback/pocket-id`
   - Put `POCKET_ID_CLIENT_ID`, `POCKET_ID_CLIENT_SECRET` and `POCKET_ID_API_KEY` into `.env`.
   - Then run `docker compose up -d api` again.

Notes:
- The session cookie is set for `freezer.malte-nowatzky.de` (`COOKIE_DOMAIN`), so the browser also sends it to `sync.freezer.malte-nowatzky.de`, and zero-cache forwards it to the API.
- The API reaches Pocket ID internally (`http://pocket-id:1411`) for discovery and signup links. The OIDC token exchange uses the public `https://id…` URL, so the VPS must be able to reach its own public hostnames (hairpin through NPM).
- `VITE_ZERO_CACHE_URL` and `VITE_PUBLIC_URL` are baked in at image build time (see the `web` build args).

## Limitations

- **No offline writes.** Zero shows cached data offline, but rejects writes. The app shows an "Offline" banner and disables buttons that change data.
- **Navigation bar color.** On Android 15+ an installed app's gesture/navigation bar shows the manifest `background_color`. A manifest has only one value, with no dark variant, so it's set to the dark surface: in dark mode the bar matches, in light mode it is dark. `theme_color` is left out on purpose (see the comment in `apps/web/vite.config.ts`).
