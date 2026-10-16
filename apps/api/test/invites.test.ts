// Behavioural tests for the invite REST endpoints: the real Hono app against Postgres (PGlite)
// with all migrations applied. Only the session lookup (header `x-test-user`) and the Pocket ID
// call are stubbed.
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

vi.mock("../src/pocket-id", () => ({ createSignupLink: async () => "https://id.example.com/st/signup-token" }));

type App = (typeof import("../src/app"))["app"];
type Db = (typeof import("../src/db"))["db"];
type Schema = (typeof import("../src/db"))["schema"];
let app: App;
let db: Db;
let schema: Schema;

beforeAll(async () => {
  ({ app } = await import("../src/app"));
  ({ db, schema } = await import("../src/db"));
  const now = new Date();
  for (const id of ["alice", "bob", "carol", "eve"])
    await db.insert(schema.user).values({ id, name: id, email: `${id}@example.com` });
  await db.insert(schema.freezer).values({ id: "f1", name: "Keller", ownerId: "alice", createdAt: now });
  await db.insert(schema.freezerMember).values([
    { freezerId: "f1", userId: "alice", role: "owner", joinedAt: now },
    { freezerId: "f1", userId: "bob", role: "member", joinedAt: now },
  ]);
});

beforeEach(async () => {
  const { eq } = await import("drizzle-orm");
  await db.delete(schema.invite);
  await db.delete(schema.freezerMember).where(eq(schema.freezerMember.userId, "carol"));
});

const post = (path: string, user?: string) =>
  app.request(path, { method: "POST", headers: { origin: ORIGIN, ...(user ? { "x-test-user": user } : {}) } });
const get = (path: string) => app.request(path);

async function createInvite() {
  const res = await post("/api/freezers/f1/invites", "alice");
  expect(res.status).toBe(200);
  return ((await res.json()) as { token: string }).token;
}

describe("POST /api/freezers/:id/invites", () => {
  it("lets the owner create an invite with a signup link", async () => {
    const token = await createInvite();
    const [row] = await db.select().from(schema.invite);
    expect(row).toMatchObject({ token, freezerId: "f1", createdBy: "alice", signupUrl: "https://id.example.com/st/signup-token" });
    expect(row!.expiresAt.getTime() - Date.now()).toBeGreaterThan(6 * 24 * 3600 * 1000);
  });

  it("rejects members, non-members and anonymous callers", async () => {
    expect((await post("/api/freezers/f1/invites", "bob")).status).toBe(403);
    expect((await post("/api/freezers/f1/invites", "eve")).status).toBe(403);
    expect((await post("/api/freezers/f1/invites")).status).toBe(401);
    expect(await db.select().from(schema.invite)).toHaveLength(0);
  });
});

describe("GET /api/invites/:token", () => {
  it("shows freezer name and signup link for a valid invite", async () => {
    const token = await createInvite();
    const res = await get(`/api/invites/${token}`);
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ freezerName: "Keller", signupUrl: "https://id.example.com/st/signup-token" });
  });

  it("returns 404 for unknown, revoked and expired invites", async () => {
    const { eq } = await import("drizzle-orm");
    expect((await get("/api/invites/nope")).status).toBe(404);
    const revoked = await createInvite();
    await db.update(schema.invite).set({ revokedAt: new Date() }).where(eq(schema.invite.token, revoked));
    expect((await get(`/api/invites/${revoked}`)).status).toBe(404);
    const expired = await createInvite();
    await db.update(schema.invite).set({ expiresAt: new Date(Date.now() - 1000) }).where(eq(schema.invite.token, expired));
    expect((await get(`/api/invites/${expired}`)).status).toBe(404);
  });
});

describe("POST /api/invites/:token/accept", () => {
  const carolMemberships = async () => {
    const { eq } = await import("drizzle-orm");
    return db.select().from(schema.freezerMember).where(eq(schema.freezerMember.userId, "carol"));
  };

  it("requires a session", async () => {
    const token = await createInvite();
    expect((await post(`/api/invites/${token}/accept`)).status).toBe(401);
  });

  it("adds the caller as a member; accepting twice is harmless", async () => {
    const token = await createInvite();
    for (let i = 0; i < 2; i++) {
      const res = await post(`/api/invites/${token}/accept`, "carol");
      expect(res.status).toBe(200);
      expect(await res.json()).toEqual({ freezerId: "f1" });
    }
    expect(await carolMemberships()).toMatchObject([{ freezerId: "f1", role: "member" }]);
  });

  it("is reusable by several people until it expires", async () => {
    const token = await createInvite();
    expect((await post(`/api/invites/${token}/accept`, "carol")).status).toBe(200);
    expect((await post(`/api/invites/${token}/accept`, "eve")).status).toBe(200);
  });

  it("does not downgrade the owner who opens their own invite", async () => {
    const { and, eq } = await import("drizzle-orm");
    const token = await createInvite();
    expect((await post(`/api/invites/${token}/accept`, "alice")).status).toBe(200);
    const [alice] = await db
      .select()
      .from(schema.freezerMember)
      .where(and(eq(schema.freezerMember.freezerId, "f1"), eq(schema.freezerMember.userId, "alice")));
    expect(alice?.role).toBe("owner");
  });

  it("rejects revoked and expired invites", async () => {
    const { eq } = await import("drizzle-orm");
    const token = await createInvite();
    await db.update(schema.invite).set({ revokedAt: new Date() }).where(eq(schema.invite.token, token));
    expect((await post(`/api/invites/${token}/accept`, "carol")).status).toBe(404);
    const expired = await createInvite();
    await db.update(schema.invite).set({ expiresAt: new Date(Date.now() - 1000) }).where(eq(schema.invite.token, expired));
    expect((await post(`/api/invites/${expired}/accept`, "carol")).status).toBe(404);
    expect(await carolMemberships()).toHaveLength(0);
  });
});

describe("client error reports", () => {
  it("accepts a report and caps the body size", async () => {
    const send = (body: string) =>
      app.request("/api/client-errors", { method: "POST", headers: { origin: ORIGIN, "content-type": "application/json" }, body });
    const spy = vi.spyOn(console, "error").mockImplementation(() => {});
    expect((await send(JSON.stringify({ message: "boom", url: "/" }))).status).toBe(204);
    expect(spy).toHaveBeenCalledWith(expect.stringContaining('"msg":"client error"'));
    expect((await send(JSON.stringify({ message: "x".repeat(20_000) }))).status).toBe(413);
    spy.mockRestore();
  });
});
