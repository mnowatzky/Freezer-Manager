// Self-registration with a code: the real Hono app; Pocket ID's signup-link call is stubbed.
import { beforeAll, describe, expect, it, vi } from "vitest";

const ORIGIN = "https://freezer.example.com";

vi.hoisted(() => {
  Object.assign(process.env, {
    DATABASE_URL: "postgres://unused:unused@127.0.0.1:1/unused",
    WEB_ORIGIN: "https://freezer.example.com",
    BETTER_AUTH_SECRET: "test-secret-test-secret-test-secret",
    POCKET_ID_URL: "https://oidc.example.com",
    POCKET_ID_CLIENT_ID: "test",
    POCKET_ID_CLIENT_SECRET: "test",
    POCKET_ID_API_KEY: "api-key",
    REGISTRATION_CODE: "tiefkuehl-2026",
    ZERO_API_KEY: "zero-key",
  });
});

const createSignupLink = vi.fn(async () => "https://oidc.example.com/st/single-use");
vi.mock("../src/pocket-id", () => ({ createSignupLink }));

let app: (typeof import("../src/app"))["app"];
beforeAll(async () => {
  ({ app } = await import("../src/app"));
  vi.spyOn(console, "log").mockImplementation(() => {});
});

const register = (code: unknown, ip = "203.0.113.1") =>
  app.request("/api/register", {
    method: "POST",
    headers: { origin: ORIGIN, "content-type": "application/json", "x-forwarded-for": ip },
    body: JSON.stringify({ code }),
  });

describe("self-registration", () => {
  it("reports that registration is enabled", async () => {
    expect(await (await app.request("/api/register")).json()).toEqual({ enabled: true });
  });

  it("issues a single-use, short-lived signup link for the right code", async () => {
    const res = await register(" tiefkuehl-2026 ");
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ signupUrl: "https://oidc.example.com/st/single-use" });
    expect(createSignupLink).toHaveBeenCalledWith(60 * 60 * 1000, 1);
  });

  it("rejects wrong or missing codes", async () => {
    expect((await register("falsch", "203.0.113.2")).status).toBe(403);
    expect((await register(undefined, "203.0.113.2")).status).toBe(403);
  });

  it("rate-limits attempts per IP", async () => {
    const statuses = [];
    for (let i = 0; i < 12; i++) statuses.push((await register("falsch", "203.0.113.3")).status);
    expect(statuses.slice(0, 10).every((s) => s === 403)).toBe(true);
    expect(statuses.slice(10)).toEqual([429, 429]);
    // The right code is also blocked from a rate-limited IP.
    expect((await register("tiefkuehl-2026", "203.0.113.3")).status).toBe(429);
  });

  it("caps attempts globally, even when the claimed IP rotates", async () => {
    const statuses = [];
    for (let i = 0; i < 60; i++) statuses.push((await register("falsch", `198.51.100.${i}`)).status);
    expect(statuses).toContain(429);
  });

  it("requires the app's origin (CSRF)", async () => {
    const res = await app.request("/api/register", {
      method: "POST",
      headers: { origin: "https://evil.example.com", "content-type": "application/json" },
      body: JSON.stringify({ code: "tiefkuehl-2026" }),
    });
    expect(res.status).toBe(403);
  });
});
