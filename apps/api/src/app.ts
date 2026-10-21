import "@freezer/shared/context";
import { buildInfo } from "@freezer/shared/build-info";
import { INVITE_TTL_MS } from "@freezer/shared/domain";
import { mutators } from "@freezer/shared/mutators";
import { queries } from "@freezer/shared/queries";
import { schema as zeroSchema } from "@freezer/shared/zero-schema";
import { mustGetMutator, mustGetQuery } from "@rocicorp/zero";
import { handleMutateRequest, handleQueryRequest } from "@rocicorp/zero/server";
import { and, eq, gt, isNull } from "drizzle-orm";
import { Hono, type Context } from "hono";
import { bodyLimit } from "hono/body-limit";
import { HTTPException } from "hono/http-exception";
import { randomBytes, randomUUID } from "node:crypto";
import { auth } from "./auth";
import { sameOriginOnly } from "./csrf";
import { db, schema, zeroDb } from "./db";
import { env } from "./env";
import { errorFields, log } from "./log";
import { createSignupLink } from "./pocket-id";
import { clientIp, rateLimiter } from "./rate-limit";
import { secretsEqual } from "./secrets";

export const app = new Hono();

// Unhandled errors: log with request context, answer with a generic message (no internals).
// Hono's own HTTP errors (e.g. 413 from bodyLimit) keep their status.
app.onError((err, c) => {
  if (err instanceof HTTPException) return err.getResponse();
  log("error", "unhandled API error", { method: c.req.method, path: c.req.path, ...errorFields(err) });
  return c.json({ error: "internal" }, 500);
});

async function sessionUserId(c: Context): Promise<string | null> {
  const session = await auth.api.getSession({ headers: c.req.raw.headers });
  return session?.user.id ?? null;
}

// Also reports the version, so the web app can show it and detect a stale bundle.
const build = buildInfo();
app.get("/api/health", (c) => c.json({ ok: true, ...build }));

// CSRF: our own cookie-authenticated endpoints only accept requests from the web app's origin.
// Better Auth checks origins for /api/auth itself; /api/zero is called server-to-server by
// zero-cache and protected by the shared API key instead.
const csrf = sameOriginOnly(env.webOrigin);
app.use("/api/*", (c, next) =>
  c.req.path.startsWith("/api/auth/") || c.req.path.startsWith("/api/zero/") ? next() : csrf(c, next),
);

app.on(["GET", "POST"], "/api/auth/*", (c) => auth.handler(c.req.raw));

// Client-side error reports from the PWA (window errors, route error boundary). Logged as
// structured lines; body size and per-IP rate are capped so it can't be used to flood logs.
const clientErrorLimit = rateLimiter(20, 60_000);
app.post("/api/client-errors", bodyLimit({ maxSize: 8 * 1024 }), async (c) => {
  if (!clientErrorLimit.allow(clientIp(c))) return c.body(null, 429);
  const report = await c.req.json().catch(() => null);
  if (!report || typeof report !== "object") return c.body(null, 400);
  const { message, stack, context, url, userAgent } = report as Record<string, unknown>;
  log("error", "client error", { message, stack, context, url, userAgent });
  return c.body(null, 204);
});

// ---------------------------------------------------------------------------
// Zero endpoints, called by zero-cache with the browser's cookies forwarded.
// The session is validated here and the user ID becomes the trusted ctx.
// ---------------------------------------------------------------------------

app.use("/api/zero/*", async (c, next) => {
  if (!secretsEqual(c.req.header("x-api-key"), env.zeroApiKey)) return c.json({ error: "forbidden" }, 403);
  await next();
});

app.post("/api/zero/query", async (c) => {
  const userID = await sessionUserId(c);
  if (!userID) return c.json({ error: "unauthorized" }, 401);
  const result = await handleQueryRequest({
    handler: (name, args) => mustGetQuery(queries, name).fn({ args, ctx: { userID } }),
    schema: zeroSchema,
    request: c.req.raw,
    userID,
  });
  return c.json(result);
});

app.post("/api/zero/mutate", async (c) => {
  const userID = await sessionUserId(c);
  if (!userID) return c.json({ error: "unauthorized" }, 401);
  const result = await handleMutateRequest({
    dbProvider: zeroDb,
    handler: (transact) =>
      transact((tx, name, args) => mustGetMutator(mutators, name).fn({ args, tx, ctx: { userID } })),
    request: c.req.raw,
    userID,
  });
  return c.json(result);
});

// ---------------------------------------------------------------------------
// Self-registration with a code (REGISTRATION_CODE). The code unlocks a single-use Pocket ID
// signup link (1 h); Pocket ID itself stays closed to open signups. Wrong codes are rate-limited
// per IP so the code can't be brute-forced.
// ---------------------------------------------------------------------------

const REGISTRATION_LINK_TTL_MS = 60 * 60 * 1000;
const registerLimit = rateLimiter(10, 15 * 60_000);
// X-Forwarded-For can be forged, so a global cap bounds guessing regardless of claimed IPs.
const registerGlobalLimit = rateLimiter(50, 60 * 60_000);

app.get("/api/register", (c) => c.json({ enabled: Boolean(env.registrationCode && env.pocketIdApiKey) }));

app.post("/api/register", bodyLimit({ maxSize: 1024 }), async (c) => {
  if (!env.registrationCode || !env.pocketIdApiKey) return c.json({ error: "disabled" }, 404);
  if (!registerLimit.allow(clientIp(c)) || !registerGlobalLimit.allow("all"))
    return c.json({ error: "rate_limited" }, 429);
  const body = (await c.req.json().catch(() => null)) as { code?: unknown } | null;
  const code = typeof body?.code === "string" ? body.code.trim() : "";
  if (!secretsEqual(code, env.registrationCode)) {
    log("warn", "registration with wrong code", { ip: clientIp(c) });
    return c.json({ error: "invalid_code" }, 403);
  }
  const signupUrl = await createSignupLink(REGISTRATION_LINK_TTL_MS, 1);
  if (!signupUrl) return c.json({ error: "unavailable" }, 503);
  log("info", "registration link issued", { ip: clientIp(c) });
  return c.json({ signupUrl });
});

// ---------------------------------------------------------------------------
// Invites (need server-generated tokens and Pocket ID signup links).
// The invite rows sync to members via Zero; revoking is a Zero mutator.
// ---------------------------------------------------------------------------

app.post("/api/freezers/:freezerId/invites", async (c) => {
  const userID = await sessionUserId(c);
  if (!userID) return c.json({ error: "unauthorized" }, 401);
  const freezerId = c.req.param("freezerId");
  const [member] = await db
    .select()
    .from(schema.freezerMember)
    .where(and(eq(schema.freezerMember.freezerId, freezerId), eq(schema.freezerMember.userId, userID)));
  if (member?.role !== "owner") return c.json({ error: "forbidden" }, 403);

  const now = Date.now();
  const token = randomBytes(18).toString("base64url");
  await db.insert(schema.invite).values({
    id: randomUUID(),
    freezerId,
    token,
    createdBy: userID,
    createdAt: new Date(now),
    expiresAt: new Date(now + INVITE_TTL_MS),
    signupUrl: await createSignupLink(INVITE_TTL_MS),
  });
  return c.json({ token });
});

async function findValidInvite(token: string) {
  const [row] = await db
    .select({ invite: schema.invite, freezerName: schema.freezer.name })
    .from(schema.invite)
    .innerJoin(schema.freezer, eq(schema.freezer.id, schema.invite.freezerId))
    .where(
      and(eq(schema.invite.token, token), isNull(schema.invite.revokedAt), gt(schema.invite.expiresAt, new Date())),
    );
  return row;
}

// Public: lets the join page show the freezer name and signup link before login.
app.get("/api/invites/:token", async (c) => {
  const row = await findValidInvite(c.req.param("token"));
  if (!row) return c.json({ error: "invalid" }, 404);
  return c.json({ freezerName: row.freezerName, signupUrl: row.invite.signupUrl });
});

app.post("/api/invites/:token/accept", async (c) => {
  const userID = await sessionUserId(c);
  if (!userID) return c.json({ error: "unauthorized" }, 401);
  const row = await findValidInvite(c.req.param("token"));
  if (!row) return c.json({ error: "invalid" }, 404);
  await db
    .insert(schema.freezerMember)
    .values({ freezerId: row.invite.freezerId, userId: userID, role: "member", joinedAt: new Date() })
    .onConflictDoNothing();
  return c.json({ freezerId: row.invite.freezerId });
});
