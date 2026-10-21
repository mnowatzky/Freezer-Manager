# Freezer Manager

A self-hosted, realtime, multi-user PWA that tracks what's in your freezer: which food is in which drawer, and in which numbered container (QR stickers). Every change shows up live for everyone who shares the freezer.

- **Live sync** between all devices and household members ([Rocicorp Zero](https://zero.rocicorp.dev/))
- **QR stickers** for reusable containers: scan one with the phone camera to see what's inside or to freeze something new
- **Passkey login** through [Pocket ID](https://pocket-id.org/), with no passwords to manage
- **Invites:** share a freezer through a link; people without an account can sign up through it
- **Installable PWA** for Android, iOS and desktop, built on Material 3 Expressive
- **English and German:** the app follows the browser's language and falls back to English

## Contents

- [Self-hosting with Docker Compose](#self-hosting-with-docker-compose)
- [How it works](#how-it-works)
- [Development](#development)
- [QR stickers and scanning](#qr-stickers-and-scanning)
- [Translations](#translations)
- [Design](#design-material-3-expressive)
- [Limitations](#limitations)
- [License](#license)

## Self-hosting with Docker Compose

The stack uses prebuilt images from Docker Hub ([`maltenow/freezer-manager`](https://hub.docker.com/r/maltenow/freezer-manager), tags `api-<version>` and `web-<version>`, for `linux/amd64` and `linux/arm64`). You don't need to clone the repository or build anything.

`docker-compose.yml` runs these services:

| Service | Image | Role |
| --- | --- | --- |
| `postgres` | `postgres:17-alpine` | Database (with `wal_level=logical` for replication) |
| `migrate` | `…:api-<tag>` | One-off: applies database migrations, then exits |
| `api` | `…:api-<tag>` | Auth, permissions, queries and mutations (Hono on Node) |
| `zero-cache` | `rocicorp/zero` | Realtime sync between Postgres and the browsers |
| `web` | `…:web-<tag>` | The static PWA on unprivileged nginx |
| `pocket-id` | `ghcr.io/pocket-id/pocket-id` | *Optional* bundled identity provider (profile `bundled-pocket-id`) |

The startup order follows the healthchecks: postgres → `migrate` → api → zero-cache. If a migration fails, the new API never starts.

### Requirements

- A server with **Docker** and the Compose plugin.
- A **reverse proxy with TLS** on the same server that can reach containers over a Docker network, for example [nginx proxy manager](https://nginxproxymanager.com/), Caddy or Traefik. The stack publishes no ports itself.
- **Two hostnames** pointing to the server. The sync hostname must be a **subdomain of the app hostname**, because the session cookie has to reach zero-cache:
  - `freezer.example.com` for the app
  - `sync.freezer.example.com` for realtime sync
- A **[Pocket ID](https://pocket-id.org/) instance** that phones and the server can reach over HTTPS. If you don't run one yet, you can use the bundled one ([see below](#optional-bundled-pocket-id)).

Passkeys, the camera and the service worker only work over HTTPS with a real hostname.

### 1. Download the files

```bash
mkdir -p /opt/freezer && cd /opt/freezer
curl -fsSLO https://raw.githubusercontent.com/mnowatzky/Freezer-Manager/main/docker-compose.yml
curl -fsSL -o .env https://raw.githubusercontent.com/mnowatzky/Freezer-Manager/main/.env.production.example
chmod 600 .env
```

### 2. Set up Pocket ID

In your Pocket ID admin interface:

1. **Signups:** Administration → Application Configuration → User Creation → **"Signup with token"**. With this setting, invites can include a signup link for people who don't have an account yet, while open self-registration stays off.
2. **Group (recommended):** create a group such as `freezer` and copy its ID into `POCKET_ID_SIGNUP_GROUP_IDS`. People who sign up through the app then land in that group only.
   If other apps use the same Pocket ID, restrict their OIDC clients to your own groups, otherwise new freezer users could sign in to them too.
3. **OIDC client:** Administration → OIDC Clients → Add.
   - Name: `Freezer Manager`, client type **Confidential**.
   - Callback URL: `https://freezer.example.com/api/auth/callback/pocket-id`.
   - Copy the **client ID** and **client secret** into `POCKET_ID_CLIENT_ID` and `POCKET_ID_CLIENT_SECRET`. The secret is only shown once.
   - Turn on **PKCE** and save.
   - **Access tab:** select "All Users" (confirm "Unrestricted"), or your own group plus `freezer`. A new client starts with no allowed groups, so nobody could sign in until you change this.
4. **API key:** Administration → API Keys → Add, then copy the key into `POCKET_ID_API_KEY`. The API uses it to create signup links. Without it, invites only work for people who already have a Pocket ID account.

### 3. Fill in `.env`

Set the hostnames, `POCKET_ID_URL`, the Pocket ID values from step 2, and generate the secrets:

```bash
openssl rand -hex 24      # POSTGRES_PASSWORD
openssl rand -base64 32   # BETTER_AUTH_SECRET
openssl rand -hex 32      # ZERO_API_KEY
openssl rand -hex 16      # ZERO_ADMIN_PASSWORD
```

Settings worth knowing:

- **`IMAGE_TAG`:** pin it to a release version (e.g. `0.1.0`, see the [releases](https://github.com/mnowatzky/Freezer-Manager/releases)) instead of `latest`, so updates and rollbacks are deliberate. While the version is `0.x`, a minor bump (`0.1` → `0.2`) may need changes to `.env` or `docker-compose.yml`; check the release notes. Settings shows which version is running.
- **`PROXY_NETWORK`:** the external Docker network your reverse proxy is on (default `npm_proxy`). If it doesn't exist yet, create it and attach the proxy:
  ```bash
  docker network create npm_proxy
  docker network connect npm_proxy <proxy-container>
  ```
- **`REGISTRATION_CODE` (optional):** lets people without an invite create an account on the login page ("No account yet?"). Anyone who knows the code can register, so hand it out personally. Wrong attempts are rate-limited. Leave it empty to make the app invite-only.

Keep a copy of `.env` somewhere safe. If you lose `BETTER_AUTH_SECRET`, all sessions become invalid.

### 4. Start the stack

```bash
docker compose pull
docker compose up -d --no-build
docker compose ps     # every service healthy, migrate "Exited (0)"
```

The first start of zero-cache can take up to a minute while it replicates the database.

### 5. Configure the reverse proxy

Start the stack **before** you add the proxy routes. Some proxies, nginx proxy manager among them, resolve container names when they load their config and fail if the containers don't exist yet.

| Hostname | Forward to | Notes |
| --- | --- | --- |
| `freezer.example.com` | `freezer-web:8080` | The path **`/api`** goes to `freezer-api:3000`, with the path kept as it is |
| `sync.freezer.example.com` | `freezer-zero:4848` | **WebSockets must be enabled** |

**nginx proxy manager:** create two proxy hosts with SSL (Force SSL, HSTS).
- On the app host, add a **custom location** `/api` → `freezer-api` : `3000`. Enter the hostname only, with no path.
- On the sync host, turn on **"Websockets Support"**.
- To check that NPM can resolve the containers, run `docker exec <npm-container> getent hosts freezer-web freezer-api freezer-zero`.

**Caddy** (attached to the same Docker network):

```caddy
freezer.example.com {
	handle /api/* {
		reverse_proxy freezer-api:3000
	}
	handle {
		reverse_proxy freezer-web:8080
	}
}

sync.freezer.example.com {
	reverse_proxy freezer-zero:4848
}
```

**Cloudflare:** request the certificates through a DNS challenge and set SSL/TLS to **Full (strict)**. The free edge certificate doesn't cover a name two levels deep like `sync.freezer.example.com`, so set that record to **DNS only** (grey cloud).

### 6. Check and sign in

```bash
curl https://freezer.example.com/api/health   # {"ok":true}
```

Open `https://freezer.example.com` and sign in with Pocket ID. On first login you create your freezer (a name and the number of drawers). Under **Settings → Create invite** you can invite others. You can also install the app from the browser (Chrome: "Install app"; Safari: "Add to Home Screen").

### Updates and rollback

Set the new `IMAGE_TAG` in `.env`, then run:

```bash
docker compose pull && docker compose up -d --no-build
```

`migrate` runs first on every start. Migrations that have already run are skipped. To roll back, set the previous `IMAGE_TAG` and run the same commands. Schema migrations are not reverted, so only roll back across releases that contain no migration, or restore a backup.

### Backups

All app data is in Postgres. To back it up:

```bash
docker compose exec -T postgres pg_dump -U freezer freezer | gzip > freezer-$(date +%F).sql.gz
```

The `zero-replica` volume is a cache that zero-cache rebuilds by itself. If you use the bundled Pocket ID, also back up the `pocket-id-data` volume and `POCKET_ID_ENCRYPTION_KEY`.

### Optional: bundled Pocket ID

To run Pocket ID inside this stack, uncomment and set these values in `.env`:

```dotenv
COMPOSE_PROFILES=bundled-pocket-id
POCKET_ID_URL=https://id.example.com
POCKET_ID_INTERNAL_URL=http://pocket-id:1411
POCKET_ID_ENCRYPTION_KEY=   # openssl rand -base64 32
```

Then:

1. Start the stack.
2. Add a proxy host `id.example.com` → `freezer-pocket-id:1411`.
3. Create your admin account and passkey at `https://id.example.com/setup`.
4. Continue with [step 2](#2-set-up-pocket-id). The bundled instance already allows signups with a token.

If you lose `POCKET_ID_ENCRYPTION_KEY`, the instance becomes unusable.

### Operations notes

- **Logins depend on Pocket ID being reachable.** Existing sessions last 30 days, and sync and editing keep working while Pocket ID is down.
- **Logs:** the API writes one JSON object per line (`docker compose logs api`). Unhandled API errors and browser errors appear as `"level":"error"` lines. The PWA reports browser errors to `/api/client-errors`, which is size- and rate-limited.
- **The web image has no domain baked in.** At container start, nginx injects `ZERO_ORIGIN` (built from `SYNC_HOST`) into the app and into its Content-Security-Policy.
- **Building the images yourself:** clone the repository and run `docker compose build`. To use your own registry, set `IMAGE_REPO`.

## How it works

| Part | Tech |
| --- | --- |
| `apps/web` | Vite, React, React Router, Tailwind, `vite-plugin-pwa` (installable, offline app shell) |
| `apps/api` | Hono on Node, Better Auth (Pocket ID via generic OIDC), Drizzle + drizzle-kit migrations |
| `packages/shared` | Drizzle schema → generated Zero schema, synced queries, custom mutators, UI strings (`i18n/`) |
| Sync | Rocicorp Zero 1.x (`zero-cache`), Postgres 17 with `wal_level=logical` |
| Auth | Pocket ID (passkeys). No local passwords. |

### Auth and permissions

1. **Sign-in:** the browser signs in through Better Auth (`/api/auth/*`) with Pocket ID (OIDC, confidential client + PKCE). The session is stored in Postgres, and the browser holds a session cookie.
2. **Connecting to sync:** the client connects to `zero-cache`. zero-cache forwards the browser's cookies, together with a shared `X-Api-Key`, to the API's `/api/zero/query` and `/api/zero/mutate` endpoints.
3. **Server checks:** the API validates the session and runs the shared queries and mutators with a trusted `ctx.userID`.
   - **Queries** only return freezers where the user has a `freezer_member` row.
   - **Mutators** check membership, and the owner role where needed, before they write.

   The same mutators also run optimistically on the client. Zero's legacy client-side permissions and CRUD mutators are not used.
4. **New accounts:** Pocket ID only accepts signups through single-use links that the API creates. People get such a link in one of two ways:
   - through an **invite**, which also adds them to that freezer
   - by entering the `REGISTRATION_CODE` on the login page, if one is set. They then create their own freezer.
5. **Invites** need work that can only happen on the server: random tokens, and a Pocket ID signup link created through the Pocket ID admin API. They therefore use small REST endpoints. The invite rows themselves sync through Zero.
6. **CSRF:** the API rejects state-changing requests to its own endpoints unless they come from the web app's origin. Better Auth checks `/api/auth` itself, and the zero-cache API key protects `/api/zero`.

## Development

### Prerequisites

- **Node ≥ 24** (tested on Node 26) and **pnpm 12**, e.g. `brew install node pnpm`
- **Docker**

> Node 26 has no prebuilt binary for Zero's native SQLite module. Only zero-cache uses that module, and it runs in Docker, so its build is skipped in `pnpm-workspace.yaml` (`allowBuilds`).

### First run

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
3. **Run the migrations.** They create the tables and the `zero_app` publication that zero-cache replicates.
   ```bash
   pnpm db:migrate
   ```
4. **Set up Pocket ID** at <http://localhost:1411/setup>. Create your admin account and passkey; WebAuthn works on `localhost` without HTTPS. Then:
   - **Administration → OIDC Clients → Add OIDC Client**:
     - Name `Freezer Manager`, client type **Confidential** (the default), callback URL `http://localhost:5173/api/auth/callback/pocket-id`.
     - After **Create**, copy the **Client ID** and **Client secret** into `.env` (`POCKET_ID_CLIENT_ID`, `POCKET_ID_CLIENT_SECRET`). The secret is only shown once.
     - On the client page, turn on **PKCE** and save.
     - **Access tab:** select **All Users** and confirm with **Unrestricted**.
   - **Administration → API Keys → Add**, then copy the key into `POCKET_ID_API_KEY`.
5. **Start zero-cache.** It needs the publication, so start it after the migrations.
   ```bash
   docker compose -f docker-compose.dev.yml up -d
   ```
6. **Start web and API** with hot reload:
   ```bash
   pnpm dev
   ```
   Open <http://localhost:5173> and sign in with Pocket ID.
7. **Optional demo data:** after your first login, run
   ```bash
   pnpm db:seed --email you@example.com
   ```
   This adds a freezer "Keller" with 5 drawers and 10 items, owned by that user.

**Testing live sync:**

1. In the app, go to **Settings** → **Create invite**.
2. Open the invite link in a private window.
3. Click **Create new account** to register a second Pocket ID user through a signup link, then sign in and join the freezer.

Changes in one window now appear in the other immediately.

### Ports (dev)

| Service | URL |
| --- | --- |
| Web (Vite, proxies `/api` → API) | http://localhost:5173 |
| API | http://localhost:3000 |
| zero-cache | http://localhost:4848 |
| Pocket ID | http://localhost:1411 |
| Postgres | localhost:5432 (`freezer` / `freezer`) |

### Testing on a phone (Tailscale Serve)

Passkeys, the camera and the service worker all need trusted HTTPS, and passkeys also need a real hostname, so a plain LAN IP won't work. You can use Tailscale on the computer and on the phone, with Serve/HTTPS enabled for the tailnet:

```bash
tailscale serve --bg --https=443   http://localhost:5173   # web + /api
tailscale serve --bg --https=8443  http://localhost:4848   # zero-cache (WebSockets)
tailscale serve --bg --https=10000 http://localhost:1411   # Pocket ID
```

1. In `.env`, set:
   - `WEB_ORIGIN=https://<host>.<tailnet>.ts.net`
   - `POCKET_ID_URL=https://<host>.<tailnet>.ts.net:10000`
   - `POCKET_ID_TRUST_PROXY=true`
   - `POCKET_ID_INTERNAL_URL=http://localhost:1411`
   - `VITE_ZERO_CACHE_URL=https://<host>.<tailnet>.ts.net:8443`
2. Add `https://<host>.<tailnet>.ts.net/api/auth/callback/pocket-id` to the OIDC client.
3. Run `docker compose -f docker-compose.dev.yml up -d pocket-id`, then restart `pnpm dev`.

Passkeys are tied to the domain, so register a new one at the ts.net address. If you can't log in there yet, create a login link with `docker exec freezer-dev-pocket-id-1 /app/pocket-id one-time-access-token <username>`.

### Scripts

| Command | What it does |
| --- | --- |
| `pnpm dev` | Web + API with hot reload |
| `pnpm test` | All tests (Vitest, against PGlite): mutators, read permissions of the Zero queries, invite REST endpoints, CSRF |
| `pnpm typecheck` | TypeScript across all packages |
| `pnpm lint` | Oxlint, type-aware (floating promises, React hooks rules, a11y, …); config in `.oxlintrc.json` |
| `pnpm build` | Production builds: the web app (`apps/web/dist`) and the bundled API (`apps/api/dist/*.mjs`) |
| `pnpm db:generate` | Create a new Drizzle migration from `packages/shared/src/db-schema.ts` |
| `pnpm db:migrate` | Apply the migrations |
| `pnpm db:seed --email …` | Add demo data |
| `pnpm zero:generate` | Regenerate `zero-schema.gen.ts` from the Drizzle schema |

**Changing the schema:**

1. Edit `packages/shared/src/db-schema.ts`.
2. Run `pnpm db:generate && pnpm zero:generate && pnpm db:migrate`.
3. Add new tables to the publication in a custom migration (`ALTER PUBLICATION zero_app ADD TABLE …`). Generate the migration with `pnpm --filter @freezer/api exec drizzle-kit generate --custom`.

### Images

- **`api`:** esbuild bundles the API into `dist/index.mjs` and `dist/migrate.mjs`, including all npm dependencies. The runtime image contains only Node, the bundle and `drizzle/` (the migration SQL). It runs as the unprivileged `node` user, and Node shuts down gracefully on `SIGTERM`.
- **`web`:** the static PWA on unprivileged nginx (port 8080), with gzip and caching rules. Its security headers include a strict Content-Security-Policy.
- Both images have a `HEALTHCHECK`.

- The version (`APP_VERSION`, `APP_COMMIT` build args) is baked into both images and shown in Settings. Builds without them show `<package.json version>-dev`.

To build and push both images for both architectures by hand:

```bash
docker buildx build --platform linux/amd64,linux/arm64 -f apps/api/Dockerfile -t <repo>:api-<tag> --push .
docker buildx build --platform linux/amd64,linux/arm64 -f apps/web/Dockerfile -t <repo>:web-<tag> --push .
```

### Releasing

Versions follow [SemVer](https://semver.org); while they are `0.x`, a minor bump may contain breaking changes. GitHub Actions run lint, typecheck, tests and build on every push to `main` and on pull requests ([`ci.yml`](.github/workflows/ci.yml)). To release, bump the version and push the tag:

```bash
npm version 0.2.0 -m "Release %s"   # updates package.json, commits and tags v0.2.0
git push --follow-tags
```

[`release.yml`](.github/workflows/release.yml) then runs the checks again, pushes `api-0.2.0`, `web-0.2.0`, `api-latest` and `web-latest` to Docker Hub (`linux/amd64` and `linux/arm64`) and creates a GitHub release with generated notes. It needs the repository secrets `DOCKERHUB_USERNAME` and `DOCKERHUB_TOKEN` (a Docker Hub access token with read & write scope).

## QR stickers and scanning

- **What a sticker encodes:** `https://<your host>/c/<number>`. Scanning it with the phone camera opens the app directly:
  - If the container is empty, you get **Freeze** with the number already filled in.
  - If it holds something, you see the item with **Take out…**.
- **Numbering:** numbers are unique per freezer, and containers don't need to be registered first.
- **Printing:** **Settings → Print QR labels** (`/labels?from=1&to=40`) prints a sheet of stickers for the current origin. In dev, `VITE_PUBLIC_URL` can override that origin.
- **Scanning in the app:** the **Scan** button uses the camera through a bundled ZXing WASM build, which also works on iOS. You can also type the number instead.

## Translations

All UI strings are in `packages/shared/src/i18n/`: `de.ts` defines the shape, and `en.ts` must match it, so a missing key fails `pnpm typecheck`. To add a language, add a file with the same shape, then register it in `LOCALES` and `messages` in `i18n/index.ts`.

Errors thrown by the mutators carry a language-neutral code (`appError`), because they also run on the server, where the user's language is unknown. The client translates the code into its own language (`errorMessage`).

## Design (Material 3 Expressive)

The UI follows [Material 3 Expressive](https://m3.material.io/). Material Web (`@material/web`) is in maintenance mode and has no Expressive components, so the app has its own small components in `apps/web/src/components/m3/`, built on the official tokens:

- **Color:**
  - `src/theme/colors.gen.css` holds the M3 color roles (light and dark). They are generated with `@material/material-color-utilities` from the brand seed `#35A9B5`, using SchemeTonalSpot and the 2025 spec.
  - To regenerate the file, run `pnpm --filter @freezer/web generate-theme`.
  - Tailwind exposes the roles as utilities such as `bg-primary-container` and `text-on-surface-variant`.
- **Shape and type:** `src/theme/tokens.css` holds the corner scale (including the Expressive `*-increased` steps) and the M3 type scale in Google Sans Flex. Use the `type-*` and `type-emphasized` utilities.
- **Motion:**
  - `src/theme/motion.ts` turns the Expressive spring tokens (fast/default/slow × spatial/effects) into Motion springs.
  - Pressed controls morph their shape.
  - Lists, sheets, FABs and the app bar animate on these springs.
  - The app respects the OS "reduce motion" setting.
- **Icons:**
  - The icons come from Material Symbols Rounded, as a self-hosted subset of the variable font (`src/theme/fonts/`, served under a content-hashed URL). The subset works offline and animates the fill on selection.
  - To add an icon, put its name into `src/theme/icon-names.txt` and run `pnpm --filter @freezer/web fetch-icons`.
- **App icons:** `pnpm --filter @freezer/web generate-icons` renders `apps/web/assets/icon*.svg` (the 108-unit adaptive-icon artwork) into four kinds of icon:
  - a round `any` icon, for browsers that create plain shortcuts (e.g. Brave)
  - a padded `maskable` icon, for Android launcher shapes
  - a `monochrome` icon, for Android themed icons
  - the Apple touch icon and the favicon

  When you install the app from Chrome on Android, Chrome creates a real WebAPK, which uses the maskable and monochrome icons.

## Limitations

- **No offline writes.** Zero shows cached data offline but rejects writes. The app shows an "Offline" banner and disables the buttons that change data.
- **No language switch.** The UI language follows the browser (German for German, English otherwise). Drawer names ("Drawer 1", "Schublade 1", …) are stored in the language of whoever created the freezer.
- **Navigation bar color.** On Android 15+, the gesture/navigation bar of an installed app shows the manifest's `background_color`. A manifest can only have one value, with no dark variant. It is set to the dark surface color, so the bar matches in dark mode and stays dark in light mode. `theme_color` is left out on purpose (see the comment in `apps/web/vite.config.ts`).

## License

[MIT](LICENSE)
