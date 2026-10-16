import { Hono } from "hono";
import { beforeAll, describe, expect, it } from "vitest";
import { sameOriginOnly } from "../src/csrf";

const ORIGIN = "https://freezer.example.com";

describe("sameOriginOnly", () => {
  const app = new Hono().use(sameOriginOnly(ORIGIN)).all("/x", (c) => c.text("ok"));
  const req = (method: string, headers: Record<string, string> = {}) => app.request("/x", { method, headers });

  it("allows safe methods from anywhere", async () => {
    expect((await req("GET", { origin: "https://evil.example.com" })).status).toBe(200);
  });

  it("allows POST from the app's origin", async () => {
    expect((await req("POST", { origin: ORIGIN })).status).toBe(200);
  });

  it("rejects POST from another origin, including sibling subdomains", async () => {
    expect((await req("POST", { origin: "https://evil.example.com" })).status).toBe(403);
    expect((await req("POST", { origin: "https://id.example.com" })).status).toBe(403);
  });

  it("falls back to Sec-Fetch-Site when Origin is missing", async () => {
    expect((await req("POST", { "sec-fetch-site": "same-origin" })).status).toBe(200);
    expect((await req("POST", { "sec-fetch-site": "same-site" })).status).toBe(403);
    expect((await req("DELETE")).status).toBe(403);
  });
});

describe("API wiring", () => {
  let app: Hono;
  beforeAll(async () => {
    Object.assign(process.env, {
      DATABASE_URL: "postgres://unused:unused@127.0.0.1:1/unused", // never connected in these tests
      WEB_ORIGIN: ORIGIN,
      BETTER_AUTH_SECRET: "test-secret-test-secret-test-secret",
      POCKET_ID_URL: "https://id.example.com",
      POCKET_ID_CLIENT_ID: "test",
      POCKET_ID_CLIENT_SECRET: "test",
      ZERO_API_KEY: "zero-key",
    });
    ({ app } = await import("../src/app"));
  });

  it("blocks cross-origin POSTs to invite endpoints before touching the database", async () => {
    const res = await app.request("/api/invites/abc/accept", { method: "POST", headers: { origin: "https://evil.example.com" } });
    expect(res.status).toBe(403);
    const res2 = await app.request("/api/freezers/f1/invites", { method: "POST" });
    expect(res2.status).toBe(403);
  });

  it("exempts /api/zero (zero-cache sends no Origin; it's protected by the API key)", async () => {
    // Correct key, no Origin, no session: passes CSRF + key checks and fails on auth.
    const res = await app.request("/api/zero/mutate", { method: "POST", headers: { "x-api-key": "zero-key" } });
    expect(res.status).toBe(401);
  });

  it("serves the health check", async () => {
    expect((await app.request("/api/health")).status).toBe(200);
  });
});
