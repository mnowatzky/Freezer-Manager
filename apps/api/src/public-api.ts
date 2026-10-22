import "@freezer/shared/context";
import { DAY_MS, freshness, isCategory, suggestionId, todayAsDate } from "@freezer/shared/domain";
import * as field from "@freezer/shared/fields";
import { parseDate } from "@freezer/shared/import";
import { mutators } from "@freezer/shared/mutators";
import { queries } from "@freezer/shared/queries";
import { mustGetMutator, mustGetQuery, type ReadonlyJSONValue } from "@rocicorp/zero";
import { and, eq, isNull } from "drizzle-orm";
import { Hono, type MiddlewareHandler } from "hono";
import { bodyLimit } from "hono/body-limit";
import { createHash, randomBytes, randomUUID } from "node:crypto";
import { z } from "zod";
import { db, schema, zeroDb } from "./db";
import { clientIp, rateLimiter } from "./rate-limit";

// Public API for scripts and Home Assistant: /api/v1/*, authenticated with personal API tokens
// (`Authorization: Bearer fm_…`) instead of the session cookie, so the cookie CSRF check doesn't apply.
// Reads go through the same synced queries as the app and writes through the same mutators, with
// ctx.userID set to the token's owner: permissions and suggestion logic live in one place.

export const TOKEN_PREFIX = "fm_";
export const hashToken = (token: string) => createHash("sha256").update(token).digest("hex");

/** A new token: `fm_` + 32 random bytes (base64url). Only its hash is stored. */
export function generateToken() {
  const token = TOKEN_PREFIX + randomBytes(32).toString("base64url");
  return { token, hash: hashToken(token), prefix: token.slice(0, 10) };
}

type Env = { Variables: { userID: string; scope: "read" | "write" } };

const perToken = rateLimiter(120, 60_000);
const failuresPerIp = rateLimiter(30, 60_000);
const LAST_USED_RESOLUTION_MS = 60_000;

const isoDate = (ms: number) => new Date(ms).toISOString().slice(0, 10);

function runQuery<T>(name: string, args: ReadonlyJSONValue | undefined, userID: string): Promise<T> {
  return zeroDb.run(mustGetQuery(queries, name).fn({ args, ctx: { userID } }) as Parameters<typeof zeroDb.run>[0]) as Promise<T>;
}

function runMutator(name: string, args: ReadonlyJSONValue | undefined, userID: string) {
  return zeroDb.transaction((tx) => mustGetMutator(mutators, name).fn({ args, tx, ctx: { userID } }));
}

type Detail = {
  id: string;
  name: string;
  drawers: { id: string; name: string; sortOrder: number }[];
  items: {
    id: string;
    name: string;
    quantity: number;
    unit: string;
    category: string | null;
    drawerId: string;
    containerNumber: number | null;
    frozenAt: number;
    bestBefore: number | null;
    notes: string | null;
  }[];
  suggestions: { id: string; lastCategory: string | null; lastUnit: string }[];
};

function itemJson(item: Detail["items"][number], drawers: Detail["drawers"], today: number) {
  const drawer = drawers.find((d) => d.id === item.drawerId);
  return {
    id: item.id,
    name: item.name,
    quantity: item.quantity,
    unit: item.unit,
    category: item.category,
    drawer: drawer ? { id: drawer.id, name: drawer.name } : null,
    containerNumber: item.containerNumber,
    frozenAt: isoDate(item.frozenAt),
    bestBefore: item.bestBefore === null ? null : isoDate(item.bestBefore),
    daysLeft: item.bestBefore === null ? null : Math.round((item.bestBefore - today) / DAY_MS),
    freshness: freshness(item.bestBefore, today),
    notes: item.notes,
  };
}

// Mutator errors carry a code (see i18n appError). Not being a member looks like "not found".
function errorResponse(err: unknown): { status: 400 | 404 | 409; body: { error: string; message: string } } | null {
  if (err instanceof z.ZodError) return { status: 400, body: { error: "invalid", message: err.issues.map((i) => `${i.path.join(".")}: ${i.message}`).join("; ") } };
  const code = (err as { details?: { code?: string } } | null)?.details?.code;
  const message = err instanceof Error ? err.message : String(err);
  if (code === "notMember" || code === "notFound" || code === "notOwner") return { status: 404, body: { error: "not_found", message: "Not found." } };
  if (code === "containerInUse") return { status: 409, body: { error: "container_in_use", message } };
  if (code === "invalidAmount") return { status: 400, body: { error: "invalid_amount", message } };
  return null;
}

const dateString = z
  .string()
  .transform((s, ctx) => parseDate(s) ?? (ctx.addIssue({ code: "custom", message: "expected YYYY-MM-DD" }), z.NEVER));

const newItemBody = z.object({
  name: field.name,
  quantity: field.quantity.default(1),
  unit: field.unit.optional(),
  category: field.category.optional(),
  /** Drawer id or name (case-insensitive); default: the first drawer. */
  drawer: z.string().trim().max(100).optional(),
  containerNumber: field.containerNumber.optional(),
  frozenAt: dateString.optional(),
  bestBefore: dateString.nullable().optional(),
  notes: field.notes.optional(),
  barcode: field.barcode.optional(),
});

const takeBody = z.object({ amount: field.quantity.optional() });
const takeByNameBody = z.object({ name: field.name, amount: field.quantity.default(1) });

const requireToken: MiddlewareHandler<Env> = async (c, next) => {
  const ip = clientIp(c);
  const token = /^Bearer\s+(\S+)$/i.exec(c.req.header("authorization") ?? "")?.[1];
  const [row] = token?.startsWith(TOKEN_PREFIX)
    ? await db
        .select()
        .from(schema.apiToken)
        .where(and(eq(schema.apiToken.tokenHash, hashToken(token)), isNull(schema.apiToken.revokedAt)))
    : [];
  if (!row) {
    if (!failuresPerIp.allow(ip)) return c.json({ error: "rate_limited" }, 429);
    return c.json({ error: "unauthorized" }, 401);
  }
  if (!perToken.allow(row.id)) return c.json({ error: "rate_limited" }, 429);
  const now = new Date();
  if (!row.lastUsedAt || now.getTime() - row.lastUsedAt.getTime() > LAST_USED_RESOLUTION_MS)
    await db.update(schema.apiToken).set({ lastUsedAt: now }).where(eq(schema.apiToken.id, row.id));
  c.set("userID", row.userId);
  c.set("scope", row.scope);
  return next();
};

const requireWrite: MiddlewareHandler<Env> = async (c, next) =>
  c.get("scope") === "write" ? next() : c.json({ error: "forbidden", message: "This token is read-only." }, 403);

const detail = (c: { get: (k: "userID") => string }, freezerId: string) =>
  runQuery<Detail | undefined>("freezers.detail", { freezerId }, c.get("userID"));

export function publicApi() {
  const api = new Hono<Env>();

  api.use("*", requireToken);
  api.onError((err, c) => {
    const mapped = errorResponse(err);
    if (!mapped) throw err;
    return c.json(mapped.body, mapped.status);
  });

  // --- Read ------------------------------------------------------------------

  api.get("/freezers", async (c) => {
    const freezers = await runQuery<{ id: string; name: string }[]>("freezers.mine", undefined, c.get("userID"));
    return c.json(freezers.map((f) => ({ id: f.id, name: f.name })));
  });

  api.get("/freezers/:id/items", async (c) => {
    const freezer = await detail(c, c.req.param("id"));
    if (!freezer) return c.json({ error: "not_found" }, 404);
    const today = todayAsDate();
    const category = c.req.query("category");
    const soon = ["1", "true", "yes"].includes(c.req.query("soon") ?? "");
    let items = freezer.items.map((i) => itemJson(i, freezer.drawers, today));
    if (category) items = items.filter((i) => (category === "none" ? i.category === null : i.category === category));
    if (soon) items = items.filter((i) => i.freshness !== "ok").sort((a, b) => (a.daysLeft ?? 0) - (b.daysLeft ?? 0));
    return c.json(items);
  });

  api.get("/freezers/:id/summary", async (c) => {
    const freezer = await detail(c, c.req.param("id"));
    if (!freezer) return c.json({ error: "not_found" }, 404);
    const today = todayAsDate();
    const items = freezer.items.map((i) => itemJson(i, freezer.drawers, today));
    const byCategory: Record<string, number> = {};
    for (const i of items) byCategory[i.category ?? "none"] = (byCategory[i.category ?? "none"] ?? 0) + 1;
    const due = items.filter((i) => i.freshness !== "ok").sort((a, b) => (a.daysLeft ?? 0) - (b.daysLeft ?? 0));
    return c.json({
      freezer: { id: freezer.id, name: freezer.name },
      items: items.length,
      soon: due.filter((i) => i.freshness === "soon").length,
      expired: due.filter((i) => i.freshness === "expired").length,
      byCategory,
      nextExpiring: due.slice(0, 10).map(({ id, name, quantity, unit, bestBefore, daysLeft, drawer }) => ({
        id,
        name,
        quantity,
        unit,
        bestBefore,
        daysLeft,
        drawer: drawer?.name ?? null,
      })),
    });
  });

  // --- Write -----------------------------------------------------------------

  api.post("/freezers/:id/items", requireWrite, bodyLimit({ maxSize: 8 * 1024 }), async (c) => {
    const userID = c.get("userID");
    const freezer = await detail(c, c.req.param("id"));
    if (!freezer) return c.json({ error: "not_found" }, 404);
    const body = newItemBody.parse(await c.req.json().catch(() => ({})));
    const wanted = body.drawer?.toLocaleLowerCase("de");
    const drawer = wanted
      ? freezer.drawers.find((d) => d.id === body.drawer || d.name.trim().toLocaleLowerCase("de") === wanted)
      : freezer.drawers[0];
    if (!drawer) return c.json({ error: "unknown_drawer", message: `No drawer "${body.drawer}".`, drawers: freezer.drawers.map((d) => d.name) }, 400);
    // Like picking a remembered food in the app: its last unit and category are the defaults.
    const known = freezer.suggestions.find((s) => s.id === suggestionId(freezer.id, body.name));
    const id = randomUUID();
    await runMutator(
      "item.add",
      {
        id,
        freezerId: freezer.id,
        drawerId: drawer.id,
        containerNumber: body.containerNumber ?? null,
        name: body.name,
        quantity: body.quantity,
        unit: body.unit ?? known?.lastUnit ?? "piece",
        frozenAt: body.frozenAt ?? todayAsDate(),
        notes: body.notes ?? null,
        category: body.category !== undefined ? body.category : isCategory(known?.lastCategory) ? known.lastCategory : null,
        ...(body.bestBefore !== undefined ? { bestBefore: body.bestBefore } : {}),
        ...(body.barcode ? { barcode: body.barcode } : {}),
      },
      userID,
    );
    const created = (await detail(c, freezer.id))?.items.find((i) => i.id === id);
    return c.json(created ? itemJson(created, freezer.drawers, todayAsDate()) : { id }, 201);
  });

  api.post("/items/:id/take", requireWrite, bodyLimit({ maxSize: 1024 }), async (c) => {
    const userID = c.get("userID");
    const body = takeBody.parse(await c.req.json().catch(() => ({})));
    const [item] = await db.select({ quantity: schema.item.quantity }).from(schema.item).where(eq(schema.item.id, c.req.param("id")));
    if (!item) return c.json({ error: "not_found" }, 404);
    // Without an amount: take it all. The mutator checks membership.
    await runMutator("item.take", { id: c.req.param("id"), amount: body.amount ?? item.quantity }, userID);
    const [left] = await db.select({ quantity: schema.item.quantity }).from(schema.item).where(eq(schema.item.id, c.req.param("id")));
    return c.json({ remaining: left?.quantity ?? 0 });
  });

  // Take out by food name (e.g. a voice command): from the oldest matching items first.
  api.post("/freezers/:id/take", requireWrite, bodyLimit({ maxSize: 1024 }), async (c) => {
    const userID = c.get("userID");
    const freezer = await detail(c, c.req.param("id"));
    if (!freezer) return c.json({ error: "not_found" }, 404);
    const body = takeByNameBody.parse(await c.req.json().catch(() => ({})));
    const wanted = body.name.toLocaleLowerCase("de");
    const matches = freezer.items.filter((i) => i.name.trim().toLocaleLowerCase("de") === wanted); // oldest first (query order)
    if (matches.length === 0) return c.json({ error: "not_found", message: `No "${body.name}" in this freezer.` }, 404);
    let open = body.amount;
    let taken = 0;
    for (const item of matches) {
      if (open <= 0) break;
      const amount = Math.min(open, item.quantity);
      await runMutator("item.take", { id: item.id, amount }, userID);
      open = Math.round((open - amount) * 1000) / 1000;
      taken = Math.round((taken + amount) * 1000) / 1000;
    }
    const remaining = matches.reduce((sum, i) => sum + i.quantity, 0) - taken;
    return c.json({ taken, remaining: Math.round(remaining * 1000) / 1000 });
  });

  api.delete("/items/:id", requireWrite, async (c) => {
    await runMutator("item.delete", { id: c.req.param("id") }, c.get("userID"));
    return c.body(null, 204);
  });

  return api;
}

