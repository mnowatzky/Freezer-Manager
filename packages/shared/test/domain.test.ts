import { describe, expect, it } from "vitest";
import { addMonths, DAY_MS, defaultBestBefore, freshness, monthsBetween, parsePackageSize, shelfLifeMonths } from "../src/domain";

const d = (iso: string) => Date.parse(`${iso}T00:00:00Z`);

describe("addMonths", () => {
  it("adds calendar months", () => {
    expect(addMonths(d("2026-01-15"), 6)).toBe(d("2026-07-15"));
    expect(addMonths(d("2026-10-01"), 4)).toBe(d("2027-02-01"));
  });

  it("clamps to the last day of shorter months", () => {
    expect(addMonths(d("2026-01-31"), 1)).toBe(d("2026-02-28"));
    expect(addMonths(d("2027-12-31"), 2)).toBe(d("2028-02-29"));
  });
});

describe("monthsBetween", () => {
  it("rounds to the nearest month, at least 1", () => {
    expect(monthsBetween(d("2026-01-15"), d("2026-07-15"))).toBe(6);
    expect(monthsBetween(d("2026-01-15"), d("2026-07-25"))).toBe(6);
    expect(monthsBetween(d("2026-01-15"), d("2026-08-05"))).toBe(7);
    expect(monthsBetween(d("2026-01-31"), d("2026-02-28"))).toBe(1);
    expect(monthsBetween(d("2026-01-15"), d("2026-01-20"))).toBe(1);
  });

  it("round-trips with addMonths", () => {
    for (const m of [1, 3, 6, 12, 18]) expect(monthsBetween(d("2026-03-31"), addMonths(d("2026-03-31"), m))).toBe(m);
  });
});

describe("default best-before", () => {
  it("prefers the food's remembered storage time over the category's", () => {
    expect(shelfLifeMonths(2, "meat")).toBe(2);
    expect(shelfLifeMonths(null, "meat")).toBe(6);
    expect(shelfLifeMonths(null, "other")).toBeNull();
    expect(shelfLifeMonths(null, null)).toBeNull();
    expect(shelfLifeMonths(null, "unknown")).toBeNull();
  });

  it("is the frozen date plus the storage time, or none", () => {
    expect(defaultBestBefore(d("2026-10-22"), 6)).toBe(d("2027-04-22"));
    expect(defaultBestBefore(d("2026-10-22"), null)).toBeNull();
  });
});

describe("freshness", () => {
  const today = d("2026-10-22");
  it("is ok without a date or with more than a week left", () => {
    expect(freshness(null, today)).toBe("ok");
    expect(freshness(today + 8 * DAY_MS, today)).toBe("ok");
  });

  it("is soon within a week, including the day itself", () => {
    expect(freshness(today + 7 * DAY_MS, today)).toBe("soon");
    expect(freshness(today, today)).toBe("soon");
  });

  it("is expired once the date has passed", () => {
    expect(freshness(today - DAY_MS, today)).toBe("expired");
  });
});

describe("parsePackageSize", () => {
  it("reads weights and volumes", () => {
    expect(parsePackageSize("750 g")).toEqual({ quantity: 750, unit: "g" });
    expect(parsePackageSize("1,5 l")).toEqual({ quantity: 1.5, unit: "l" });
    expect(parsePackageSize("500ml")).toEqual({ quantity: 500, unit: "ml" });
    expect(parsePackageSize("33 cl")).toEqual({ quantity: 330, unit: "ml" });
    expect(parsePackageSize("2 x 250 g")).toEqual({ quantity: 500, unit: "g" });
    expect(parsePackageSize("1 kg e")).toEqual({ quantity: 1, unit: "kg" });
  });

  it("ignores anything else", () => {
    for (const text of ["10 Stück", "", null, undefined, "approx. 400 g", "0 g"]) expect(parsePackageSize(text)).toBeNull();
  });
});
