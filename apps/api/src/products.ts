import { buildInfo } from "@freezer/shared/build-info";
import type { Category } from "@freezer/shared/domain";
import type { Locale } from "@freezer/shared/i18n";
import { env } from "./env";
import { errorFields, log } from "./log";

// Product lookup for scanned barcodes via Open Food Facts (OFF), proxied by the API because
// browsers can't set the User-Agent OFF asks for, the CSP's connect-src stays 'self', the user's
// IP isn't sent to a third party, and answers can be cached. OFF data is licensed under the ODbL.
// API docs: https://openfoodfacts.github.io/openfoodfacts-server/api/

export type Product = { name: string | null; brand: string | null; packageSize: string | null; category: Category | null };

type OffProduct = {
  product_name?: string;
  product_name_de?: string;
  product_name_en?: string;
  brands?: string;
  quantity?: string;
  categories_tags?: string[];
};

// OFF category tags (most specific wins) → our categories. Unknown tags give null.
const CATEGORY_TAGS: Record<string, Category> = {};
const tag = (category: Category, ...tags: string[]) => tags.forEach((t) => (CATEGORY_TAGS[`en:${t}`] = category));
tag("meat", "meats", "meat", "beef", "pork", "minced-meat", "sausages", "hams", "prepared-meats", "meatballs");
tag("poultry", "poultries", "poultry", "chicken", "chickens", "chicken-meat", "turkey", "turkeys", "duck", "ducks");
tag("fish", "fishes", "fish", "frozen-fishes", "fish-fillets", "seafood", "salmons", "shrimps", "fish-sticks");
tag("vegetables", "vegetables", "frozen-vegetables", "vegetables-based-foods", "legumes", "peas", "spinachs", "potatoes", "french-fries", "beans");
tag("fruit", "fruits", "frozen-fruits", "fruits-based-foods", "berries", "raspberries", "strawberries", "blueberries");
tag("herbs", "herbs", "frozen-herbs", "aromatic-plants");
tag("baked", "breads", "bread-rolls", "baguettes", "pastries", "viennoiseries", "doughs", "pizza-doughs", "bakery-products");
tag("meals", "meals", "ready-meals", "frozen-ready-meals", "prepared-meals", "pizzas", "frozen-pizzas", "pasta-dishes", "lasagnas");
tag("soups", "soups", "broths", "stocks");
tag("dairy", "dairies", "cheeses", "butters", "milks", "creams", "dairy-substitutes", "milk-substitutes", "plant-based-milk-alternatives");
tag("desserts", "desserts", "frozen-desserts", "ice-creams", "ice-creams-and-sorbets", "sorbets", "cakes");

export function categoryFromTags(tags: readonly string[] | undefined): Category | null {
  for (const t of (tags ?? []).toReversed()) {
    const category = CATEGORY_TAGS[t];
    if (category) return category;
  }
  return null;
}

export function toProduct(p: OffProduct, locale: Locale): Product {
  const localized = locale === "de" ? p.product_name_de : p.product_name_en;
  const name = (localized || p.product_name || p.product_name_en || p.product_name_de || "").trim();
  return {
    name: name || null,
    brand: p.brands?.split(",")[0]?.trim() || null,
    packageSize: p.quantity?.trim() || null,
    category: categoryFromTags(p.categories_tags),
  };
}

// In-memory LRU cache (24 h), including "not found" answers (null).
const CACHE_TTL_MS = 24 * 60 * 60 * 1000;
const CACHE_SIZE = 2000;
const cache = new Map<string, { at: number; product: OffProduct | null }>();

export function cached(code: string): { product: OffProduct | null } | undefined {
  const hit = cache.get(code);
  if (!hit) return undefined;
  cache.delete(code);
  if (Date.now() - hit.at > CACHE_TTL_MS) return undefined;
  cache.set(code, hit); // most recently used last
  return hit;
}

function remember(code: string, product: OffProduct | null) {
  cache.set(code, { at: Date.now(), product });
  if (cache.size > CACHE_SIZE) cache.delete(cache.keys().next().value!);
}

export class LookupFailed extends Error {}

const userAgent = `FreezerManager/${buildInfo().version} (${env.openFoodFacts.contact})`;

/** Fetches a product from OFF (no cache); null when OFF doesn't know the code. */
export async function fetchProduct(code: string, fetchImpl: typeof fetch = fetch): Promise<OffProduct | null> {
  const off = env.openFoodFacts;
  const url = `${off.baseUrl}/api/v2/product/${code}.json?fields=code,product_name,product_name_de,product_name_en,brands,quantity,categories_tags`;
  let res: Response;
  try {
    res = await fetchImpl(url, {
      headers: {
        "User-Agent": userAgent,
        ...(off.authorization ? { Authorization: off.authorization } : {}),
      },
      signal: AbortSignal.timeout(5000),
    });
  } catch (err) {
    log("warn", "Open Food Facts unreachable", errorFields(err));
    throw new LookupFailed();
  }
  if (res.status === 404) return null;
  if (!res.ok) {
    log("warn", "Open Food Facts error", { status: res.status });
    throw new LookupFailed();
  }
  const body = (await res.json().catch(() => null)) as { status?: number; product?: OffProduct } | null;
  return body?.status === 1 && body.product ? body.product : null;
}

/** Cached lookup; `beforeFetch` runs only when OFF actually has to be asked (for rate limiting). */
export async function lookupProduct(code: string, beforeFetch: () => boolean, fetchImpl?: typeof fetch) {
  const hit = cached(code);
  if (hit) return hit.product;
  if (!beforeFetch()) return "rate_limited" as const;
  const product = await fetchProduct(code, fetchImpl);
  remember(code, product);
  return product;
}

export function clearProductCache() {
  cache.clear();
}
