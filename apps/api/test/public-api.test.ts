// API tokens and the public API (/api/v1) against Postgres (PGlite) with all migrations applied.
// Only the cookie session lookup (header `x-test-user`, used to create tokens) is stubbed.
import { beforeAll, beforeEach, describe, expect, it, vi } from "vitest";

const ORIGIN = "https://freezer.example.com";

vi.hoisted(() => {
  Object.assign(process.env, {
    DATABASE_URL: "postgres://unused:unused@127.0.0.1:1/unused",
    WEB_ORIGIN: "https://freezer.example.com",
    BETTER_AUTH_SECRET: "test-secret-test-secret-test-secret",
    POCKET_ID_URL: "https://id.example.com",
    POCKET_ID_CLIENT_ID: "test",
    POCKET_ID_CLIENT_SECRET: "test",
    ZERO_API_KEY: "zero-key",
  });
});

vi.mock("../src/db", async () => {
  const { PGlite } = await import("@electric-sql/pglite");
  const { drizzle } = await import("drizzle-orm/pglite");
  const { zeroDrizzle } = await import("@rocicorp/zero/server/adapters/drizzle");
  const { readFileSync } = await import("node:fs");
  const schema = await import("@freezer/shared/db-schema");
  const { schema: zeroSchema } = await import("@freezer/shared/zero-schema");
  const pg = new PGlite();
  const dir = new URL("../drizzle/", import.meta.url);
  const journal = JSON.parse(readFileSync(new URL("meta/_journal.json", dir), "utf8")) as { entries: { tag: string }[] };
  for (const { tag } of journal.entries)
    for (const stmt of readFileSync(new URL(`${tag}.sql`, dir), "utf8").split("--> statement-breakpoint")) await pg.exec(stmt);
  const db = drizzle(pg, { schema });
  return { db, schema, zeroDb: zeroDrizzle(zeroSchema, db), sql: { end: async () => {} } };
});

vi.mock("../src/auth", () => ({
  auth: {
    api: {
      getSession: async ({ headers }: { headers: Headers }) => {
        const id = headers.get("x-test-user");
        return id ? { user: { id } } : null;
      },
    },
    handler: () => new Response(null, { status: 404 }),
  },
}));

type App = (typeof import("../src/app"))["app"];
type Db = (typeof import("../src/db"))["db"];
type Schema = (typeof import("../src/db"))["schema"];
let app: App;
let db: Db;
let schema: Schema;

const DAY = 86_400_000;
const iso = (offsetDays: number) => {
  const now = new Date();
  return new Date(Date.UTC(now.getFullYear(), now.getMonth(), now.getDate()) + offsetDays * DAY).toISOString().slice(0, 10);
};

beforeAll(async () => {
  ({ app } = await import("../src/app"));
  ({ db, schema } = await import("../src/db"));
  const now = new Date();
  for (const id of ["alice", "bob", "eve"]) await db.insert(schema.user).values({ id, name: id, email: `${id}@example.com` });
  await db.insert(schema.freezer).values([
    { id: "f1", name: "Keller", ownerId: "alice", createdAt: now },
    { id: "f2", name: "Eve", ownerId: "eve", createdAt: now },
  ]);
  await db.insert(schema.freezerMember).values([
    { freezerId: "f1", userId: "alice", role: "owner", joinedAt: now },
    { freezerId: "f1", userId: "bob", role: "member", joinedAt: now },
    { freezerId: "f2", userId: "eve", role: "owner", joinedAt: now },
  ]);
  await db.insert(schema.drawer).values([
    { id: "d1", freezerId: "f1", name: "Schublade 1", sortOrder: 0 },
    { id: "d2", freezerId: "f1", name: "Schublade 2", sortOrder: 1 },
    { id: "e1", freezerId: "f2", name: "Drawer 1", sortOrder: 0 },
  ]);
});

beforeEach(async () => {
  await db.delete(schema.apiToken);
  await db.delete(schema.item);
  await db.delete(schema.foodSuggestion);
});

async function createToken(user: string, scope: "read" | "write" = "write", origin: string | null = ORIGIN) {
  return app.request("/api/tokens", {
    method: "POST",
    headers: { "content-type": "application/json", "x-test-user": user, ...(origin ? { origin } : {}) },
    body: JSON.stringify({ name: "Home Assistant", scope }),
  });
}
async function token(user: string, scope: "read" | "write" = "write") {
  return ((await (await createToken(user, scope)).json()) as { token: string }).token;
}
const v1 = (path: string, tok: string | null, init: { method?: string; body?: unknown } = {}) =>
  app.request(`/api/v1${path}`, {
    method: init.method ?? "GET",
    headers: { ...(tok ? { authorization: `Bearer ${tok}` } : {}), ...(init.body ? { "content-type": "application/json" } : {}) },
    body: init.body ? JSON.stringify(init.body) : undefined,
  });

async function addItem(id: string, name: string, over: Record<string, unknown> = {}) {
  await db.insert(schema.item).values({
    id,
    freezerId: "f1",
    drawerId: "d1",
    name,
    quantity: 2,
    unit: "portion",
    frozenAt: iso(-60),
    createdBy: "alice",
    createdAt: new Date(),
    ...over,
  });
}

describe("POST /api/tokens", () => {
  it("creates a token that is shown once and stored only as a hash", async () => {
    const res = await createToken("alice", "read");
    expect(res.status).toBe(201);
    const { token: tok } = (await res.json()) as { token: string };
    expect(tok).toMatch(/^fm_[A-Za-z0-9_-]{43}$/);
    const [row] = await db.select().from(schema.apiToken);
    expect(row).toMatchObject({ userId: "alice", name: "Home Assistant", scope: "read", prefix: tok.slice(0, 10) });
    expect(row!.tokenHash).not.toContain(tok.slice(3));
  });

  it("needs a session and the app's origin", async () => {
    expect((await app.request("/api/tokens", { method: "POST", headers: { origin: ORIGIN } })).status).toBe(401);
    expect((await createToken("alice", "write", "https://evil.example.com")).status).toBe(403);
    expect(await db.select().from(schema.apiToken)).toHaveLength(0);
  });

  it("allows at most 20 active tokens per user", async () => {
    for (let i = 0; i < 20; i++) expect((await createToken("bob")).status).toBe(201);
    expect((await createToken("bob")).status).toBe(409);
  });
});

describe("authentication", () => {
  it("rejects missing, unknown and revoked tokens, and cookies", async () => {
    expect((await v1("/freezers", null)).status).toBe(401);
    expect((await v1("/freezers", "fm_nope")).status).toBe(401);
    expect((await app.request("/api/v1/freezers", { headers: { "x-test-user": "alice" } })).status).toBe(401);
    const tok = await token("alice");
    expect((await v1("/freezers", tok)).status).toBe(200);
    await db.update(schema.apiToken).set({ revokedAt: new Date() });
    expect((await v1("/freezers", tok)).status).toBe(401);
  });

  it("records when a token was last used", async () => {
    const tok = await token("alice");
    await v1("/freezers", tok);
    const [row] = await db.select().from(schema.apiToken);
    expect(row!.lastUsedAt).toBeInstanceOf(Date);
  });

  it("read-only tokens can't write", async () => {
    const tok = await token("alice", "read");
    expect((await v1("/freezers/f1/items", tok, { method: "POST", body: { name: "Eis" } })).status).toBe(403);
  });
});

describe("read", () => {
  it("lists the token owner's freezers only", async () => {
    expect(await (await v1("/freezers", await token("bob"))).json()).toEqual([{ id: "f1", name: "Keller" }]);
    expect((await v1("/freezers/f2/items", await token("bob"))).status).toBe(404);
  });

  it("lists items, filtered by category or by what to eat soon", async () => {
    await addItem("i1", "Gulasch", { category: "meals", bestBefore: iso(3), containerNumber: 4 });
    await addItem("i2", "Erbsen", { category: "vegetables", bestBefore: iso(100), drawerId: "d2" });
    await addItem("i3", "Reste", { bestBefore: iso(-2) });
    const tok = await token("bob");
    const all = (await (await v1("/freezers/f1/items", tok)).json()) as unknown[];
    expect(all).toHaveLength(3);
    expect(all[0]).toEqual({
      id: "i1",
      name: "Gulasch",
      quantity: 2,
      unit: "portion",
      category: "meals",
      drawer: { id: "d1", name: "Schublade 1" },
      containerNumber: 4,
      frozenAt: iso(-60),
      bestBefore: iso(3),
      daysLeft: 3,
      freshness: "soon",
      notes: null,
    });
    expect(((await (await v1("/freezers/f1/items?category=vegetables", tok)).json()) as { id: string }[]).map((i) => i.id)).toEqual(["i2"]);
    expect(((await (await v1("/freezers/f1/items?soon=true", tok)).json()) as { id: string }[]).map((i) => i.id)).toEqual(["i3", "i1"]);
  });

  it("summarizes the freezer for a Home Assistant sensor", async () => {
    await addItem("i1", "Gulasch", { category: "meals", bestBefore: iso(3) });
    await addItem("i2", "Erbsen", { category: "vegetables", bestBefore: iso(100) });
    await addItem("i3", "Reste", { bestBefore: iso(-2) });
    expect(await (await v1("/freezers/f1/summary", await token("alice", "read"))).json()).toEqual({
      freezer: { id: "f1", name: "Keller" },
      items: 3,
      soon: 1,
      expired: 1,
      byCategory: { meals: 1, vegetables: 1, none: 1 },
      nextExpiring: [
        { id: "i3", name: "Reste", quantity: 2, unit: "portion", bestBefore: iso(-2), daysLeft: -2, drawer: "Schublade 1" },
        { id: "i1", name: "Gulasch", quantity: 2, unit: "portion", bestBefore: iso(3), daysLeft: 3, drawer: "Schublade 1" },
      ],
    });
  });
});

describe("write", () => {
  it("freezes an item through the same mutator as the app", async () => {
    const tok = await token("bob");
    const res = await v1("/freezers/f1/items", tok, { method: "POST", body: { name: "Gulasch", quantity: 3, unit: "portion", category: "meals", drawer: "schublade 2", containerNumber: 7 } });
    expect(res.status).toBe(201);
    expect(await res.json()).toMatchObject({ name: "Gulasch", quantity: 3, drawer: { name: "Schublade 2" }, containerNumber: 7, frozenAt: iso(0), freshness: "ok" });
    const [row] = await db.select().from(schema.item);
    expect(row).toMatchObject({ createdBy: "bob", category: "meals" });
    expect(row!.bestBefore).not.toBeNull(); // the category's storage time
    expect(await db.select().from(schema.foodSuggestion)).toMatchObject([{ name: "Gulasch", useCount: 1 }]);

    // A remembered food brings its unit and category; the first drawer is the default.
    const again = (await (await v1("/freezers/f1/items", tok, { method: "POST", body: { name: "gulasch" } })).json()) as Record<string, unknown>;
    expect(again).toMatchObject({ unit: "portion", category: "meals", quantity: 1, drawer: { name: "Schublade 1" } });
  });

  it("finds the drawer by name, id or position", async () => {
    const tok = await token("bob");
    const drawerOf = async (drawer: unknown) =>
      ((await (await v1("/freezers/f1/items", tok, { method: "POST", body: { name: "Eis", drawer } })).json()) as { drawer?: { id: string } }).drawer?.id;
    expect(await drawerOf("SCHUBLADE 2")).toBe("d2");
    expect(await drawerOf("d2")).toBe("d2");
    expect(await drawerOf(2)).toBe("d2");
    expect(await drawerOf("2")).toBe("d2");
    expect(await drawerOf("")).toBe("d1");
    expect((await v1("/freezers/f1/items", tok, { method: "POST", body: { name: "Eis", drawer: 3 } })).status).toBe(400);
  });

  it("answers errors with a status and a message", async () => {
    const tok = await token("bob");
    await v1("/freezers/f1/items", tok, { method: "POST", body: { name: "A", containerNumber: 7 } });
    expect((await v1("/freezers/f1/items", tok, { method: "POST", body: { name: "B", containerNumber: 7 } })).status).toBe(409);
    expect((await v1("/freezers/f1/items", tok, { method: "POST", body: { name: "" } })).status).toBe(400);
    expect((await v1("/freezers/f1/items", tok, { method: "POST", body: { name: "C", unit: "barrel" } })).status).toBe(400);
    expect((await v1("/freezers/f1/items", tok, { method: "POST", body: { name: "C", frozenAt: "yesterday" } })).status).toBe(400);
    expect((await v1("/freezers/f1/items", tok, { method: "POST", body: { name: "C", drawer: "Garage" } })).status).toBe(400);
    expect((await v1("/freezers/f2/items", tok, { method: "POST", body: { name: "C" } })).status).toBe(404);
  });

  it("takes some or all of an item, and deletes items", async () => {
    await addItem("i1", "Gulasch", { quantity: 3 });
    await addItem("i2", "Brot");
    const tok = await token("bob");
    expect(await (await v1("/items/i1/take", tok, { method: "POST", body: { amount: 1 } })).json()).toEqual({ remaining: 2 });
    expect(await (await v1("/items/i1/take", tok, { method: "POST" })).json()).toEqual({ remaining: 0 });
    expect((await v1("/items/i1/take", tok, { method: "POST" })).status).toBe(404);
    expect((await v1("/items/i2", tok, { method: "DELETE" })).status).toBe(204);
    expect(await db.select().from(schema.item)).toHaveLength(0);
  });

  it("takes out by name, oldest first", async () => {
    await addItem("old", "Gulasch", { quantity: 1, frozenAt: iso(-90) });
    await addItem("new", "Gulasch", { quantity: 2, frozenAt: iso(-10) });
    const tok = await token("bob");
    expect(await (await v1("/freezers/f1/take", tok, { method: "POST", body: { name: "gulasch", amount: 2 } })).json()).toEqual({ taken: 2, remaining: 1 });
    expect(await db.select({ id: schema.item.id, quantity: schema.item.quantity }).from(schema.item)).toEqual([{ id: "new", quantity: 1 }]);
    expect((await v1("/freezers/f1/take", tok, { method: "POST", body: { name: "Pizza" } })).status).toBe(404);
  });

  it("doesn't let tokens touch other people's freezers", async () => {
    await addItem("i1", "Gulasch");
    const tok = await token("eve");
    expect((await v1("/items/i1/take", tok, { method: "POST" })).status).toBe(404);
    expect((await v1("/items/i1", tok, { method: "DELETE" })).status).toBe(404);
    expect(await db.select().from(schema.item)).toHaveLength(1);
  });
});
