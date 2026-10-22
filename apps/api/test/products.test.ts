// Barcode lookups via the Open Food Facts proxy: the real Hono app with the session lookup
// (header `x-test-user`) and OFF itself (global fetch) stubbed.
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";

vi.hoisted(() => {
  Object.assign(process.env, {
    DATABASE_URL: "postgres://unused:unused@127.0.0.1:1/unused",
    WEB_ORIGIN: "https://freezer.example.com",
    BETTER_AUTH_SECRET: "test-secret-test-secret-test-secret",
    POCKET_ID_URL: "https://id.example.com",
    POCKET_ID_CLIENT_ID: "test",
    POCKET_ID_CLIENT_SECRET: "test",
    ZERO_API_KEY: "zero-key",
    OFF_BASE_URL: "https://off:off@world.openfoodfacts.net",
    OFF_CONTACT: "admin@example.com",
  });
});

vi.mock("../src/db", () => ({ db: {}, schema: {}, zeroDb: {}, sql: { end: async () => {} } }));
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
let app: App;
let products: typeof import("../src/products");

beforeAll(async () => {
  ({ app } = await import("../src/app"));
  products = await import("../src/products");
});

const fetchMock = vi.fn<typeof fetch>();
let clock = Date.now();

beforeEach(() => {
  products.clearProductCache();
  fetchMock.mockReset();
  vi.stubGlobal("fetch", fetchMock);
  // Rate limits are per minute: every test starts in a fresh window.
  vi.useFakeTimers({ toFake: ["Date"] });
  clock += 120_000;
  vi.setSystemTime(clock);
});

afterEach(() => {
  vi.useRealTimers();
  vi.unstubAllGlobals();
});

const lookup = (code: string, user: string | null = "alice", lang = "de") =>
  app.request(`/api/products/${code}?lang=${lang}`, { headers: user ? { "x-test-user": user } : {} });

const offAnswer = (product: Record<string, unknown>) => new Response(JSON.stringify({ status: 1, product }), { status: 200 });
const peas = {
  code: "4001234567890",
  product_name: "Petits pois",
  product_name_de: "Junge Erbsen",
  product_name_en: "Garden peas",
  brands: "Frosta, Nestlé",
  quantity: "750 g",
  categories_tags: ["en:plant-based-foods", "en:frozen-foods", "en:vegetables", "en:frozen-vegetables", "en:peas"],
};

describe("GET /api/products/:code", () => {
  it("needs a session and a barcode-shaped code", async () => {
    expect((await lookup("4001234567890", null)).status).toBe(401);
    expect((await lookup("123")).status).toBe(400);
    expect((await lookup("40012345abc90")).status).toBe(400);
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("maps the product in the user's language and asks OFF the way it requires", async () => {
    fetchMock.mockResolvedValueOnce(offAnswer(peas));
    expect(await (await lookup("4001234567890")).json()).toEqual({
      found: true,
      name: "Junge Erbsen",
      brand: "Frosta",
      packageSize: "750 g",
      category: "vegetables",
    });
    const [url, init] = fetchMock.mock.calls[0]!;
    expect(url as string).toMatch(/^https:\/\/world\.openfoodfacts\.net\/api\/v2\/product\/4001234567890\.json\?fields=/);
    const headers = init!.headers as Record<string, string>;
    expect(headers["User-Agent"]).toMatch(/^FreezerManager\/\S+ \(admin@example\.com\)$/);
    expect(headers.Authorization).toBe(`Basic ${Buffer.from("off:off").toString("base64")}`);

    // Cached: a second lookup (also in another language) doesn't ask OFF again.
    expect(await (await lookup("4001234567890", "bob", "en")).json()).toMatchObject({ name: "Garden peas" });
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it("answers found: false for unknown products and caches that too", async () => {
    fetchMock.mockResolvedValueOnce(new Response(JSON.stringify({ status: 0 }), { status: 404 }));
    expect(await (await lookup("12345678")).json()).toEqual({ found: false });
    expect(await (await lookup("12345678")).json()).toEqual({ found: false });
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it("reports OFF outages without caching them", async () => {
    fetchMock.mockResolvedValueOnce(new Response("busy", { status: 503 }));
    fetchMock.mockRejectedValueOnce(new Error("timeout"));
    expect((await lookup("12345678")).status).toBe(502);
    expect((await lookup("12345678")).status).toBe(502);
    fetchMock.mockResolvedValueOnce(offAnswer(peas));
    expect((await lookup("12345678")).status).toBe(200);
    expect(fetchMock).toHaveBeenCalledTimes(3);
  });

  it("limits OFF calls to 10 per user per minute; cached answers don't count", async () => {
    fetchMock.mockImplementation(async () => offAnswer(peas));
    for (let i = 0; i < 10; i++) expect((await lookup(`1000000${i}`)).status).toBe(200);
    expect((await lookup("10000010")).status).toBe(429);
    expect((await lookup("10000000")).status).toBe(200); // cached
    expect((await lookup("10000011", "bob")).status).toBe(200);
  });
});

describe("categoryFromTags", () => {
  it("uses the most specific known tag", async () => {
    const { categoryFromTags } = products;
    expect(categoryFromTags(["en:meals", "en:pizzas"])).toBe("meals");
    expect(categoryFromTags(["en:desserts", "en:frozen-desserts", "en:ice-creams"])).toBe("desserts");
    expect(categoryFromTags(["en:plant-based-foods", "en:breads"])).toBe("baked");
    expect(categoryFromTags(["en:meats", "en:poultries", "en:chickens"])).toBe("poultry");
    expect(categoryFromTags(["en:snacks"])).toBeNull();
    expect(categoryFromTags(undefined)).toBeNull();
  });
});
