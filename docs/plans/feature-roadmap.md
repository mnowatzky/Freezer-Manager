# Feature roadmap: undo, eat soon + push, categories, barcodes, export/import, API + Home Assistant

Implementation plan for the next features of Freezer Manager. Each feature (A–G) is meant to be one PR and one minor release. File paths are relative to the repository root.

## How to work through this plan

- Pick the first feature below whose status is not `done`. Respect the "Depends on" column.
- Before starting a feature, check the **Open decisions** section. If a decision affecting that feature isn't marked as confirmed, ask the user first; the bracketed value is the proposed default.
- Read the files the feature section names before changing them. Match the existing style: shared logic in `packages/shared`, permission checks inside the mutators, UI strings in `packages/shared/src/i18n/{de,en}.ts` (both languages, always).
- Schema changes follow the README ("Changing the schema"): edit `packages/shared/src/db-schema.ts`, then `pnpm db:generate && pnpm zero:generate && pnpm db:migrate`. New tables that should sync need a custom migration that adds them to the `zero_app` publication (`pnpm --filter @freezer/api exec drizzle-kit generate --custom`). Tables that must not sync are simply left out of the publication.
- New Material Symbols icons must be added to `apps/web/src/theme/icon-names.txt`, then run the `fetch-icons` script (the icon font is subset).
- Before finishing: `pnpm test`, `pnpm typecheck`, `pnpm lint`. Add tests next to the existing ones (`packages/shared/test/mutators.test.ts` for mutators and queries, `apps/api/test/` for REST endpoints; both run against PGlite).
- Don't commit, tag or release unless the user asks. Releasing is `npm version <x.y.z>` + `git push --follow-tags`.
- When a feature is finished, update its status in the table below.

## Order and status

| # | Feature | Depends on | Schema change | Size | Status |
|---|---|---|---|---|---|
| A | Undo for take-out and delete | — | none | S | done |
| B | Categories | — | `item.category`, `food_suggestion.last_category` | S–M | done |
| C | Eat soon (best-before dates) | B | `item.best_before`, `food_suggestion.shelf_life_months` | M | done |
| D | Push notifications one week before best-before | C | `push_subscription`, `expiry_notice` (not synced) | L | done |
| E | Barcode scanning with Open Food Facts | B | `barcode` table (synced) | M | todo |
| F | Export / import | B, C | none | M | todo |
| G | API tokens + Home Assistant | C | `api_token` (synced without hash column) | M–L | todo |

## Open decisions

Ask the user about any decision still marked `proposed` before implementing the feature it affects.

| Affects | Question | Proposed default | Status |
|---|---|---|---|
| B | Fixed category list, or user-defined categories per freezer? | Fixed list | confirmed: fixed list for now; user-defined categories may come later |
| D | Who gets the notification: all members of a freezer, or only the person who froze the item? | All members | confirmed: all members |
| D | Only the one-week warning, or also a notification on the day itself? | One-week warning only | confirmed: both |
| E | Open Food Facts lookups enabled by default, with an env var to turn them off? | Yes | confirmed |
| all | Order A → B → C → D → E → F → G, one release each? | Yes | confirmed; one PR per feature |

---

## A. Undo for take-out and delete

**Current state:** `item.take` in `packages/shared/src/mutators.ts` deletes the row when the quantity reaches 0. There is an `item.delete` mutator, but no UI calls it, so the only way to remove an item is "Take out → All" in `apps/web/src/components/ItemSheet.tsx`.

**Shared (`packages/shared/src/mutators.ts`)**
- New mutator `item.putBack({ snapshot, amount })`:
  - If the item still exists, add `amount` to its quantity. A partial undo then stays correct even if someone else took some in the meantime.
  - Otherwise, insert the snapshot with `quantity = amount`.
  - Checks: `requireRole` on `snapshot.freezerId`, `requireDrawerInFreezer`. If the container number has been reused meanwhile, restore the item without a container number instead of failing, and return a flag so the client can say so.
  - Don't bump `food_suggestion.useCount`. Set `createdBy` from `ctx.userID`, not from the snapshot, so it can't be forged.
- Chosen over soft delete (`deleted_at`): soft delete would need a filter in every query and a partial unique index for containers, and only pays off once there's an activity log or statistics.

**Web**
- `apps/web/src/lib/toast.tsx`: change the API to `show(text, action?: { label, onClick })`. With an action, the toast stays visible about 6 s and the button is focusable. Keep existing `toast(text)` callers working.
- `ItemSheet.tsx` `Take`: snapshot the item before mutating; after success show "Took 2 portions of soup · Undo"; Undo calls `putBack`.
- Add a **Delete** button to the edit form (`ItemForm` in `apps/web/src/components/ItemDialog.tsx`, text variant, error colour) with the same undo toast.
- i18n keys: `undo`, `took(name, qty)`, `deleted(name)`, `restoredWithoutContainer(n)`.

**Tests:** put back after a full take, after a partial take, with a concurrent take in between, with the container taken in the meantime, and as a non-member.

---

## B. Categories

**Domain (`packages/shared/src/domain.ts`):** a fixed list like `UNITS`, so it can be translated and mapped to icons, default storage times (used by C) and OFF categories (used by E):

```ts
export const CATEGORIES = {
  meat:       { months: 6 },  poultry: { months: 8 },  fish:   { months: 4 },
  vegetables: { months: 12 }, fruit:   { months: 10 }, herbs:  { months: 8 },
  baked:      { months: 3 },  meals:   { months: 3 },  soups:  { months: 4 },
  dairy:      { months: 6 },  desserts:{ months: 3 },  other:  { months: null },
} as const;
```

The storage times are rough defaults based on common freezer guidance; users override them per food (see C).

**Schema:** `item.category text null`, `food_suggestion.last_category text null`. Both tables are already in the `zero_app` publication without a column list, so the new columns replicate.

**Mutators:** `item.add` and `item.update` accept `category` (zod enum, nullable). `item.add` stores it on the suggestion the same way it stores `lastUnit`.

**Web**
- Category selector in `ItemForm` (`apps/web/src/components/ItemDialog.tsx`): chips with icons rather than a select. Pre-filled when a suggestion is picked.
- `apps/web/src/routes/HomePage.tsx`: horizontally scrolling filter chips under the search field, showing only categories that have items. Category icon in each list row.
- Icon candidates (add to `icon-names.txt`): `kebab_dining`, `egg`, `set_meal`, `nutrition`, `spa`, `bakery_dining`, `lunch_dining`, `soup_kitchen`, `icecream`, `category`. Check that each name exists in Material Symbols Rounded.

---

## C. Eat soon

**Model:** an explicit `item.best_before date null`, rather than computing it at display time, because:
- the user can edit it per item (e.g. to match a date printed on a store package)
- the notification job (D) and the API (G) can query it with plain SQL
- it doesn't change silently when defaults change

**Default when freezing:** `frozenAt + months`, where months comes from, in order:
1. `food_suggestion.shelf_life_months` (override per food)
2. `CATEGORIES[category].months`
3. otherwise no date (no warning)

If the user changes the date in the form, the mutator saves the resulting number of months to the suggestion, so the next item with that name gets the same storage time. Existing items keep `null`.

**Domain:** `EAT_SOON_DAYS = 7` and a pure `freshness(bestBefore, today) → "ok" | "soon" | "expired"`, unit-tested. Dates use the same representation as `frozenAt` (epoch ms at UTC midnight, see `todayAsDate`).

**Web**
- Form: a "Best before" date field below "Frozen on". Filled automatically and recomputed when category or frozen date change, as long as the user hasn't edited it by hand.
- List rows: a coloured chip ("in 5 days" / "2 weeks over") using the `tertiary-container` and `error-container` tokens.
- Home: a collapsible "Eat soon" section at the top for `soon` and `expired` items across all drawers, and a "Best before" sort option in the view toggle.

---

## D. Push notifications one week before best-before

**Setup:** Web Push with VAPID keys and the `web-push` npm package in the API. Optional env vars `VAPID_PUBLIC_KEY`, `VAPID_PRIVATE_KEY`, `VAPID_SUBJECT` (`mailto:…`) in `apps/api/src/env.ts`, `.env.example`, `.env.production.example` and `docker-compose.yml`. If unset, the feature is hidden. Document `npx web-push generate-vapid-keys` in the README.

**Service worker:** today `apps/web/vite.config.ts` uses workbox `generateSW`, which can't handle `push` events. Switch to `strategies: "injectManifest"` with a new `apps/web/src/sw.ts`:
- `precacheAndRoute(self.__WB_MANIFEST)` plus a `NavigationRoute` to `/index.html` with the existing `/api/` denylist. Move the current `globPatterns` and `maximumFileSizeToCacheInBytes` into the `injectManifest` options. Keep `devOptions` working.
- `skipWaiting` + `clientsClaim` to keep the current `autoUpdate` behaviour.
- `push`: `showNotification(title, { body, tag: "eat-soon", data: { url } })`.
- `notificationclick`: focus an existing window and navigate it to `/?soon`, or open a new one.
- Riskiest step for existing installs: test updating from 0.1.x on Android and iOS before releasing.

**Schema** (neither table is added to the publication):
- `push_subscription(id, user_id → user cascade, endpoint unique, p256dh, auth, locale, created_at, last_success_at)`
- `expiry_notice(item_id → item cascade, kind 'soon'|'due', best_before, pk (item_id, kind))`: which `best_before` each kind of notification was already sent for. If the date is changed, the next run notifies again.

**API (`apps/api/src/app.ts`)**
- `GET /api/push/key` → public key.
- `POST /api/push/subscriptions` upserts by endpoint and stores `locale` from the client.
- `DELETE /api/push/subscriptions` by endpoint.
- All three require the session and go through the existing CSRF middleware.

**Job (`apps/api/src/expiry-job.ts`, started from `apps/api/src/index.ts`):** checks hourly with `setInterval(…).unref()`, runs once a day after `NOTIFY_HOUR` (default 9, in the container's `TZ`). `pg_try_advisory_lock` keeps it safe with multiple replicas.
1. Select items with `best_before <= today + EAT_SOON_DAYS` and no matching `expiry_notice` of kind `soon`, plus items with `best_before <= today` and no matching notice of kind `due` (decision: both the one-week warning and one on the day itself).
2. Group them by freezer member (every member, per the default decision).
3. One notification per user and subscription: "3 items should be eaten soon: Bolognese (in 6 days), Bread (in 2 days), …" in the subscription's language via `messages[locale]` from `packages/shared/src/i18n`.
4. Insert the `expiry_notice` rows.
5. Delete subscriptions when the push service answers 404 or 410.

Write the job as a pure function with injected `now` and `send` so it can be tested against PGlite.

**Web (`apps/web/src/routes/SettingsPage.tsx`)**
- "Notifications on this device" switch. Call `Notification.requestPermission()` directly from the tap (iOS requires a user gesture), then `pushManager.subscribe` and post to the API.
- When running as a website on iOS (not installed), show a hint that Web Push needs the installed app (iOS 16.4+).

---

## E. Barcode scanning with Open Food Facts

**Lookup order:** the freezer's own barcode memory, then Open Food Facts, then manual input. Corrections stick, and a product scanned a second time needs no network round trip.

**Schema:** synced `barcode` table: `id = freezerId:code`, `freezer_id`, `code`, `name`, `unit`, `category`. Add it to the publication in a custom migration (`ALTER PUBLICATION zero_app ADD TABLE barcode`) and include it in `queries.freezers.detail`. `item.add` takes an optional `barcode` and upserts the mapping with the name, unit and category that were actually saved.

**API proxy `GET /api/products/:code`** instead of calling OFF from the browser, because browsers can't set the `User-Agent` OFF requires, the strict CSP `connect-src` stays unchanged, the user's IP isn't sent to a third party, and responses can be cached.
- Validate `^\d{8,14}$`, require a session.
- Fetch `${OFF_BASE_URL}/api/v2/product/{code}.json?fields=code,product_name,product_name_de,product_name_en,brands,quantity,categories_tags` with a 5 s timeout and `User-Agent: FreezerManager/<version> (<OFF_CONTACT or repo URL>)`. `OFF_BASE_URL` defaults to `https://world.openfoodfacts.org`; in development use staging `https://world.openfoodfacts.net` (HTTP basic auth `off:off`).
- In-memory LRU cache for 24 h, including "not found" answers.
- Rate limit 10 lookups per minute per user (OFF allows 15 product reads per minute per IP, and all users share the server's IP). Reuse `apps/api/src/rate-limit.ts`.
- Map to `{ name, brand, packageSize, category }`. Category from `categories_tags` via a small mapping table (`en:meats` → meat, `en:frozen-vegetables` → vegetables, `en:breads` → baked, `en:ice-creams` → desserts, …); unknown tags give `null`.
- `OFF_ENABLED=false` turns the lookup off.
- OFF docs: https://openfoodfacts.github.io/openfoodfacts-server/api/ — reads need no auth, only the custom User-Agent; exceeding limits can get the IP banned.

**Web**
- `apps/web/src/components/Scanner.tsx`: add a `mode` prop. Barcode mode uses formats `ean_13`, `ean_8`, `upc_a`, `upc_e` (supported by the bundled ZXing WASM).
- `ItemForm`: a barcode icon button next to the name field opens the scanner; the lookup fills in name, category, unit and best-before.
  - Quantity defaults to 1 bag or piece, with the package size (e.g. "750 g") offered as a one-tap alternative.
  - Show "Data from Open Food Facts" in small text when OFF data was used (data licensed under ODbL).
  - If nothing is found: toast, focus the name field, and still save the barcode with the item.

---

## F. Export / import

**Export (client-side, no server needed):** the client already has the full freezer from Zero. Settings gets "Export" with two formats:
- **JSON** `{ format: "freezer-manager", version: 1, freezer, drawers, items, suggestions, barcodes }` for backups and moving between instances.
- **CSV** with columns `name, quantity, unit, category, drawer, container, frozen_at, best_before, notes`: UTF-8 with BOM, `;` as separator when the UI is German (so Excel opens it correctly), ISO dates.

**Import:** file picker → preview (rows, warnings, what will happen) → Import.
- Parse and validate on the client against a shared zod schema in `packages/shared/src/import.ts`. Factor the per-field zod schemas out of `mutators.ts` so both use the same rules.
- New mutator `freezer.import({ freezerId, drawers, items })`, allowed for any member:
  - Match drawers by name; create missing ones up to `MAX_DRAWERS`.
  - If a container number is taken, import the item without one (shown in the preview).
  - Upsert suggestions and barcodes.
  - At most 1,000 items per call; split larger files into several calls.
- A JSON file can also be imported as a new freezer (`freezer.create`, then `freezer.import`).
- README: this export covers a user's own data; server backups remain `pg_dump`, documented next to it.

**Tests:** CSV round-trip including quoted fields, commas and decimal commas; drawer matching; container conflicts; the item limit; non-members.

---

## G. API tokens + Home Assistant

**Schema:** `api_token(id, user_id, name, token_hash, prefix, scope 'read'|'write', created_at, last_used_at, revoked_at)`. Publish it with a column list that leaves out `token_hash`, the same pattern as `"user" (id, name, email)` in `apps/api/drizzle/0001_zero_publication.sql`, and add a query that returns only the user's own tokens. Revoking is a mutator, like `invite.revoke`.

**Creating a token:** `POST /api/tokens` (session + CSRF) generates `fm_<32 random bytes base64url>`, stores a SHA-256 hash and returns the token once.

**Public API `/api/v1/*`:** `Authorization: Bearer …`, excluded from the cookie CSRF check (no cookies involved).
- Middleware: hash the token, look it up, check it isn't revoked, rate-limit, update `last_used_at` at most once a minute.
- Read scope: `GET /api/v1/freezers`, `GET /api/v1/freezers/:id/items?category=&soon=`, `GET /api/v1/freezers/:id/summary` → `{ items, soon, expired, byCategory, nextExpiring: [...] }`.
- Write scope: `POST /api/v1/freezers/:id/items`, `POST /api/v1/items/:id/take`, `DELETE /api/v1/items/:id`.
  - Run the shared mutators in a server-side Zero transaction (`zeroDb` in `apps/api/src/db.ts`) with `ctx.userID` set to the token owner, so permissions and suggestion logic aren't duplicated. **Verify first** that Zero's server API allows running a mutator outside a push request; if not, fall back to Drizzle plus the `require*` helpers moved into a shared module.
  - Changes reach the apps live through replication.

**Home Assistant:** no custom integration at first; document a YAML snippet in the README:
- a `rest` sensor on `/summary` (state = number of items expiring soon, attributes = the list)
- a `rest_command` for freezing and taking out
- an HA Assist custom sentence ("I froze {quantity} {food} in drawer {drawer}") that calls the `rest_command`; this also gives voice input through HA's Alexa link, without an Alexa skill

A HACS integration can come later if people ask for it.

**Web (Settings):** "API tokens" section with name, scope, "last used" and revoke, plus a copy-once dialog after creating a token.
