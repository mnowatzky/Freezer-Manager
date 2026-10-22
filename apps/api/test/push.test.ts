// Push subscriptions (REST) and the daily best-before job, against Postgres (PGlite) with all
// migrations applied. The session lookup (header `x-test-user`) and the push service are stubbed.
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
    VAPID_PUBLIC_KEY: "public-key",
    VAPID_PRIVATE_KEY: "private-key",
    VAPID_SUBJECT: "mailto:admin@example.com",
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
type Job = typeof import("../src/expiry-job");
let app: App;
let db: Db;
let schema: Schema;
let job: Job;

beforeAll(async () => {
  ({ app } = await import("../src/app"));
  ({ db, schema } = await import("../src/db"));
  job = await import("../src/expiry-job");
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
    { id: "d2", freezerId: "f2", name: "Drawer 1", sortOrder: 0 },
  ]);
});

beforeEach(async () => {
  await db.delete(schema.pushSubscription);
  await db.delete(schema.item);
});

const endpoint = (n = 1) => `https://fcm.googleapis.com/fcm/send/device-${n}`;
const subscription = (n = 1, locale = "de") => ({ endpoint: endpoint(n), keys: { p256dh: `p256dh-${n}`, auth: `auth-${n}` }, locale });
const request = (method: string, path: string, user?: string, body?: unknown, origin = ORIGIN) =>
  app.request(path, {
    method,
    headers: { "content-type": "application/json", ...(origin ? { origin } : {}), ...(user ? { "x-test-user": user } : {}) },
    body: body === undefined ? undefined : JSON.stringify(body),
  });

describe("push subscription endpoints", () => {
  it("hands out the public key to signed-in users only", async () => {
    expect((await request("GET", "/api/push/key")).status).toBe(401);
    const res = await request("GET", "/api/push/key", "alice");
    expect(await res.json()).toEqual({ publicKey: "public-key" });
  });

  it("stores a subscription, and moves it when the device signs in as someone else", async () => {
    expect((await request("POST", "/api/push/subscriptions", "alice", subscription())).status).toBe(204);
    expect(await db.select().from(schema.pushSubscription)).toMatchObject([{ userId: "alice", endpoint: endpoint(), locale: "de" }]);
    await request("POST", "/api/push/subscriptions", "bob", subscription(1, "en"));
    expect(await db.select().from(schema.pushSubscription)).toMatchObject([{ userId: "bob", locale: "en" }]);
  });

  it("only accepts endpoints of the browsers' push services", async () => {
    for (const bad of ["http://fcm.googleapis.com/x", "https://evil.example.com/x", "https://fcm.googleapis.com.evil.com/x", "https://localhost:3000/x", "https://fcm.googleapis.com:8443/x", "nope"])
      expect((await request("POST", "/api/push/subscriptions", "alice", { ...subscription(), endpoint: bad })).status).toBe(400);
    for (const good of ["https://web.push.apple.com/abc", "https://updates.push.services.mozilla.com/wpush/v2/abc", "https://wns2-par02p.notify.windows.com/w/?token=abc"])
      expect((await request("POST", "/api/push/subscriptions", "alice", { ...subscription(), endpoint: good })).status).toBe(204);
  });

  it("requires a session and the app's origin", async () => {
    expect((await request("POST", "/api/push/subscriptions", undefined, subscription())).status).toBe(401);
    expect((await request("POST", "/api/push/subscriptions", "alice", subscription(), "https://evil.example.com")).status).toBe(403);
    expect((await request("DELETE", "/api/push/subscriptions", "alice", { endpoint: endpoint() }, "https://evil.example.com")).status).toBe(403);
    expect(await db.select().from(schema.pushSubscription)).toHaveLength(0);
  });

  it("deletes only the caller's own subscription", async () => {
    await request("POST", "/api/push/subscriptions", "alice", subscription());
    await request("DELETE", "/api/push/subscriptions", "eve", { endpoint: endpoint() });
    expect(await db.select().from(schema.pushSubscription)).toHaveLength(1);
    expect((await request("DELETE", "/api/push/subscriptions", "alice", { endpoint: endpoint() })).status).toBe(204);
    expect(await db.select().from(schema.pushSubscription)).toHaveLength(0);
  });
});

describe("best-before job", () => {
  const NOW = new Date(2026, 9, 22, 9, 30); // 22 Oct 2026, local time
  const day = (offset: number) => new Date(Date.UTC(2026, 9, 22 + offset)).toISOString().slice(0, 10);
  let sent: { endpoint: string; title: string; body: string; url: string }[];
  let status: number;
  const send: import("../src/expiry-job").Send = async (sub, payload) => {
    sent.push({ endpoint: sub.endpoint, ...payload });
    return { statusCode: status };
  };
  const run = (now = NOW) => job.runExpiryJob({ db, now, send });

  async function addItem(id: string, name: string, bestBefore: string | null, freezerId = "f1") {
    await db.insert(schema.item).values({
      id,
      freezerId,
      drawerId: freezerId === "f1" ? "d1" : "d2",
      name,
      quantity: 1,
      unit: "portion",
      frozenAt: day(-90),
      bestBefore,
      createdBy: "alice",
      createdAt: new Date(),
    });
  }

  beforeEach(async () => {
    sent = [];
    status = 201;
    await request("POST", "/api/push/subscriptions", "alice", subscription(1, "de"));
    await request("POST", "/api/push/subscriptions", "bob", subscription(2, "en"));
    await request("POST", "/api/push/subscriptions", "eve", subscription(3, "en"));
  });

  it("notifies every member of the freezer once, in their language", async () => {
    await addItem("i1", "Bolognese", day(6));
    await addItem("i2", "Brot", day(2));
    await addItem("i3", "Erbsen", day(30)); // not yet
    await addItem("i4", "Eis", null); // no date
    await addItem("i5", "Eves Pizza", day(1), "f2");

    expect(await run()).toMatchObject({ items: 3, sent: 3 });
    expect(sent.find((s) => s.endpoint === endpoint(1))).toEqual({
      endpoint: endpoint(1),
      title: "2 Lebensmittel sollten bald gegessen werden",
      body: "Brot (in 2 Tagen), Bolognese (in 6 Tagen)",
      url: "/?soon",
      tag: "eat-soon",
    });
    expect(sent.find((s) => s.endpoint === endpoint(2))?.body).toBe("Brot (in 2 days), Bolognese (in 6 days)");
    expect(sent.find((s) => s.endpoint === endpoint(3))).toMatchObject({ title: "1 item should be eaten soon", body: "Eves Pizza (tomorrow)" });

    sent = [];
    expect(await run()).toMatchObject({ items: 0, sent: 0 });
    expect(sent).toHaveLength(0);
  });

  it("notifies again on the day itself", async () => {
    await addItem("i1", "Bolognese", day(6));
    await run();
    sent = [];
    expect(await run(new Date(2026, 9, 28, 10))).toMatchObject({ items: 1 });
    expect(sent.map((s) => s.body)).toContain("Bolognese (heute)");
    sent = [];
    await run(new Date(2026, 9, 29, 10));
    expect(sent).toHaveLength(0);
  });

  it("notifies again when the date is changed", async () => {
    const { eq } = await import("drizzle-orm");
    await addItem("i1", "Bolognese", day(6));
    await run();
    await db.update(schema.item).set({ bestBefore: day(5) }).where(eq(schema.item.id, "i1"));
    sent = [];
    expect(await run()).toMatchObject({ items: 1 });
  });

  it("skips items whose date passed long ago", async () => {
    await addItem("i1", "Alt", day(-30));
    await addItem("i2", "Gestern", day(-1));
    await run();
    expect(sent.map((s) => s.body).sort()).toEqual(["Gestern (1 Tag drüber)", "Gestern (1 day over)"]);
  });

  it("lists at most five items", async () => {
    for (let i = 0; i < 7; i++) await addItem(`i${i}`, `Essen ${i}`, day(i));
    await run();
    const de = sent.find((s) => s.endpoint === endpoint(1))!;
    expect(de.title).toBe("7 Lebensmittel sollten bald gegessen werden");
    expect(de.body.split(", ")).toHaveLength(6);
    expect(de.body.endsWith(", …")).toBe(true);
  });

  it("removes subscriptions the push service no longer knows", async () => {
    await addItem("i1", "Bolognese", day(3));
    status = 410;
    expect(await run()).toMatchObject({ sent: 0, removed: 2 });
    expect((await db.select().from(schema.pushSubscription)).map((s) => s.userId)).toEqual(["eve"]);
  });

  it("records the notice even when nobody has a subscription", async () => {
    await db.delete(schema.pushSubscription);
    await addItem("i1", "Bolognese", day(3));
    expect(await run()).toMatchObject({ items: 1, sent: 0 });
    expect(await db.select().from(schema.expiryNotice)).toMatchObject([{ itemId: "i1", kind: "soon", bestBefore: day(3) }]);
  });
});
