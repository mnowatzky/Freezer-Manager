import { isCategory, UNITS, type Category, type Unit } from "@freezer/shared/domain";
import type { FreezerDetail } from "./freezer-data";
import { locale } from "./i18n";

export type BarcodeLookup =
  | { source: "freezer"; name: string; quantity: number; unit: Unit | null; category: Category | null }
  | { source: "off"; name: string; category: Category | null; packageSize: string | null }
  | { source: "none"; reason: "notFound" | "limited" | "failed" };

const isUnit = (u: string): u is Unit => (UNITS as readonly string[]).includes(u);

/**
 * What is this product? First the freezer's own barcode memory (synced, no network round trip, keeps
 * corrections), then Open Food Facts through the API, otherwise the user types the name.
 */
export async function lookupBarcode(code: string, freezer: FreezerDetail): Promise<BarcodeLookup> {
  const known = freezer.barcodes.find((b) => b.code === code);
  if (known)
    return {
      source: "freezer",
      name: known.name,
      quantity: known.quantity,
      unit: isUnit(known.unit) ? known.unit : null,
      category: isCategory(known.category) ? known.category : null,
    };

  let res: Response;
  try {
    res = await fetch(`/api/products/${code}?lang=${locale}`);
  } catch {
    return { source: "none", reason: "failed" };
  }
  if (res.status === 429) return { source: "none", reason: "limited" };
  // 404 = lookups turned off on this server (OFF_ENABLED=false): same as an unknown product.
  if (res.status === 404) return { source: "none", reason: "notFound" };
  if (!res.ok) return { source: "none", reason: "failed" };
  const product = (await res.json()) as { found: boolean; name?: string | null; category?: string | null; packageSize?: string | null };
  if (!product.found || !product.name) return { source: "none", reason: "notFound" };
  return {
    source: "off",
    name: product.name.slice(0, 100),
    category: isCategory(product.category) ? product.category : null,
    packageSize: product.packageSize ?? null,
  };
}
