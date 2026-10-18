import { afterEach, describe, expect, it, vi } from "vitest";

vi.hoisted(() => {
  Object.assign(process.env, {
    DATABASE_URL: "postgres://unused:unused@127.0.0.1:1/unused",
    WEB_ORIGIN: "https://freezer.example.com",
    BETTER_AUTH_SECRET: "test-secret-test-secret-test-secret",
    POCKET_ID_URL: "https://oidc.example.com",
    POCKET_ID_INTERNAL_URL: "",
    POCKET_ID_CLIENT_ID: "test",
    POCKET_ID_CLIENT_SECRET: "test",
    POCKET_ID_API_KEY: "api-key",
    POCKET_ID_SIGNUP_GROUP_IDS: "grp-freezer, grp-family",
    ZERO_API_KEY: "zero-key",
  });
});

const { createSignupLink } = await import("../src/pocket-id");

afterEach(() => vi.unstubAllGlobals());

describe("createSignupLink", () => {
  it("creates a token via the public URL (no internal URL) with the signup groups", async () => {
    const fetchMock = vi.fn(async () => Response.json({ token: "tok123" }));
    vi.stubGlobal("fetch", fetchMock);
    const link = await createSignupLink(7 * 24 * 3600 * 1000);
    expect(link).toBe("https://oidc.example.com/st/tok123");
    const [url, init] = fetchMock.mock.calls[0] as unknown as [string, RequestInit];
    expect(url).toBe("https://oidc.example.com/api/signup-tokens");
    expect((init.headers as Record<string, string>)["X-API-KEY"]).toBe("api-key");
    expect(JSON.parse(init.body as string)).toEqual({ ttl: 604800, usageLimit: 10, userGroupIds: ["grp-freezer", "grp-family"] });
  });

  it("returns null (invites still work for existing users) when Pocket ID refuses", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => new Response("forbidden", { status: 403 })));
    vi.spyOn(console, "log").mockImplementation(() => {});
    expect(await createSignupLink(1000)).toBeNull();
  });
});
