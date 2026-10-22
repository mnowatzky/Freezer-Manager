import { PGlite } from "@electric-sql/pglite";
import { mustGetQuery } from "@rocicorp/zero";
import { zeroDrizzle } from "@rocicorp/zero/server/adapters/drizzle";
import { drizzle } from "drizzle-orm/pglite";
import { readFileSync } from "node:fs";
import { beforeEach, describe, expect, it } from "vitest";
import * as dbSchema from "../src/db-schema";
import { todayAsDate } from "../src/domain";
import { de, errorMessage } from "../src/i18n";
import { buildExport, MAX_IMPORT_ITEMS, parseImport, type ImportItem } from "../src/import";
import { mutators } from "../src/mutators";
import { queries } from "../src/queries";
import { schema, zql } from "../src/zero-schema.gen";

// Runs the mutators and queries the way the API does: server-side, against Postgres (PGlite)
// with every Drizzle migration applied in journal order.
const migrationsDir = new URL("../../../apps/api/drizzle/", import.meta.url);
const journal = JSON.parse(readFileSync(new URL("meta/_journal.json", migrationsDir), "utf8")) as { entries: { tag: string }[] };
const migrations = journal.entries.map((e) => readFileSync(new URL(`${e.tag}.sql`, migrationsDir), "utf8"));

let db: ReturnType<typeof drizzle<typeof dbSchema>>;
let zdb: ReturnType<typeof zeroDrizzle<typeof schema, ReturnType<typeof drizzle<typeof dbSchema>>>>;

async function as(userID: string, run: (m: typeof mutators) => { fn: Function; args: unknown }) {
  const req = run(mutators);
  return zdb.transaction((tx) => req.fn({ tx, ctx: { userID }, args: req.args }));
}

// Mutators return MutateRequests; unpack into {fn, args} for direct server execution.
function call<A>(mr: { mutator: { fn: Function }; args: A }) {
  return { fn: mr.mutator.fn, args: mr.args };
}

beforeEach(async () => {
  const pg = new PGlite();
  for (const migration of migrations)
    for (const stmt of migration.split("--> statement-breakpoint")) await pg.exec(stmt);
  db = drizzle(pg, { schema: dbSchema });
  for (const id of ["alice", "bob", "eve"])
    await db.insert(dbSchema.user).values({ id, name: id, email: `${id}@example.com` });
  zdb = zeroDrizzle(schema, db);

  await as("alice", (m) => call(m.freezer.create({ id: "f1", name: "Keller", drawerIds: ["d1", "d2"] })));
  await zdb.transaction((tx) =>
    tx.mutate.freezerMember.insert({ freezerId: "f1", userId: "bob", role: "member", joinedAt: Date.now() }),
  );
});

const addArgs = (over: Record<string, unknown> = {}) => ({
  id: "i1",
  freezerId: "f1",
  drawerId: "d1",
  containerNumber: 5 as number | null,
  name: "Frikadellen",
  quantity: 5,
  unit: "piece" as const,
  frozenAt: todayAsDate(),
  notes: null,
  ...over,
});

describe("permissions", () => {
  it("creates owner membership and drawers", async () => {
    const drawers = await zdb.run(zql.drawer.where("freezerId", "f1").orderBy("sortOrder", "asc"));
    expect(drawers.map((d) => d.name)).toEqual(["Schublade 1", "Schublade 2"]);
    const owner = await zdb.run(zql.freezerMember.where("userId", "alice").one());
    expect(owner?.role).toBe("owner");
  });

  it("names the drawers in the creator's language", async () => {
    await as("alice", (m) => call(m.freezer.create({ id: "f2", name: "Garage", drawerIds: ["e1"], locale: "en" })));
    expect((await zdb.run(zql.drawer.where("freezerId", "f2"))).map((d) => d.name)).toEqual(["Drawer 1"]);
  });

  it("non-member cannot add items", async () => {
    await expect(as("eve", (m) => call(m.item.add(addArgs())))).rejects.toThrow(/No access/);
  });

  it("non-member cannot take from or delete an item", async () => {
    await as("bob", (m) => call(m.item.add(addArgs())));
    await expect(as("eve", (m) => call(m.item.take({ id: "i1", amount: 1 })))).rejects.toThrow(/No access/);
    await expect(as("eve", (m) => call(m.item.delete({ id: "i1" })))).rejects.toThrow(/No access/);
  });

  it("member cannot remove others or delete the freezer", async () => {
    await expect(as("bob", (m) => call(m.member.remove({ freezerId: "f1", userId: "alice" })))).rejects.toThrow(
      /owner/,
    );
    await expect(as("bob", (m) => call(m.freezer.delete({ freezerId: "f1" })))).rejects.toThrow(/owner/);
  });

  it("owner can remove a member but not themselves", async () => {
    await expect(as("alice", (m) => call(m.member.remove({ freezerId: "f1", userId: "alice" })))).rejects.toThrow(
      /owner/,
    );
    await as("alice", (m) => call(m.member.remove({ freezerId: "f1", userId: "bob" })));
    expect(await zdb.run(zql.freezerMember.where("userId", "bob"))).toHaveLength(0);
  });

  it("member can leave; owner cannot leave", async () => {
    await expect(as("alice", (m) => call(m.member.leave({ freezerId: "f1" })))).rejects.toThrow(/owner/);
    await as("bob", (m) => call(m.member.leave({ freezerId: "f1" })));
    expect(await zdb.run(zql.freezerMember.where("userId", "bob"))).toHaveLength(0);
  });

  it("item.update: members only, and not into an occupied container", async () => {
    await as("alice", (m) => call(m.item.add(addArgs())));
    await as("alice", (m) => call(m.item.add(addArgs({ id: "i2", containerNumber: 6 }))));
    const update = (over: Record<string, unknown> = {}) => {
      const { freezerId: _f, ...rest } = addArgs({ name: "Buletten", ...over });
      return rest;
    };
    await expect(as("eve", (m) => call(m.item.update(update())))).rejects.toThrow(/No access/);
    await expect(as("bob", (m) => call(m.item.update(update({ containerNumber: 6 }))))).rejects.toThrow(/Container 6/);
    await as("bob", (m) => call(m.item.update(update({ drawerId: "d2", quantity: 3 }))));
    expect(await zdb.run(zql.item.where("id", "i1").one())).toMatchObject({ name: "Buletten", drawerId: "d2", quantity: 3 });
  });

  it("invite.revoke: owner only", async () => {
    await zdb.transaction((tx) =>
      tx.mutate.invite.insert({ id: "inv1", freezerId: "f1", token: "t", createdBy: "alice", createdAt: Date.now(), expiresAt: Date.now() + 1e6 }),
    );
    await expect(as("bob", (m) => call(m.invite.revoke({ inviteId: "inv1" })))).rejects.toThrow(/owner/);
    await expect(as("eve", (m) => call(m.invite.revoke({ inviteId: "inv1" })))).rejects.toThrow(/No access/);
    await as("alice", (m) => call(m.invite.revoke({ inviteId: "inv1" })));
    expect((await zdb.run(zql.invite.where("id", "inv1").one()))?.revokedAt).toBeTypeOf("number");
  });

  it("suggestion.delete: members only", async () => {
    await as("alice", (m) => call(m.item.add(addArgs({ containerNumber: null }))));
    const [s] = await zdb.run(zql.foodSuggestion.where("freezerId", "f1"));
    await expect(as("eve", (m) => call(m.suggestion.delete({ id: s.id })))).rejects.toThrow(/No access/);
    await as("bob", (m) => call(m.suggestion.delete({ id: s.id })));
    expect(await zdb.run(zql.foodSuggestion.where("freezerId", "f1"))).toHaveLength(0);
  });

  it("rejects a drawer from another freezer", async () => {
    await as("eve", (m) => call(m.freezer.create({ id: "f2", name: "Eve", drawerIds: ["e1"] })));
    await expect(as("alice", (m) => call(m.item.add(addArgs({ drawerId: "e1" }))))).rejects.toThrow(/Not found/);
  });
});

describe("items", () => {
  it("container number is unique per freezer", async () => {
    await as("alice", (m) => call(m.item.add(addArgs())));
    await expect(as("bob", (m) => call(m.item.add(addArgs({ id: "i2" }))))).rejects.toThrow(/Container 5/);
    // Same number in another freezer is fine.
    await as("eve", (m) => call(m.freezer.create({ id: "f2", name: "Eve", drawerIds: ["e1"] })));
    await as("eve", (m) => call(m.item.add(addArgs({ id: "i3", freezerId: "f2", drawerId: "e1" }))));
  });

  it("take reduces quantity and deletes at zero, freeing the container", async () => {
    await as("alice", (m) => call(m.item.add(addArgs())));
    await as("bob", (m) => call(m.item.take({ id: "i1", amount: 3 })));
    expect((await zdb.run(zql.item.where("id", "i1").one()))?.quantity).toBe(2);
    await expect(as("bob", (m) => call(m.item.take({ id: "i1", amount: 3 })))).rejects.toThrow(/Invalid amount/);
    await as("bob", (m) => call(m.item.take({ id: "i1", amount: 2 })));
    expect(await zdb.run(zql.item.where("id", "i1").one())).toBeUndefined();
    await as("alice", (m) => call(m.item.add(addArgs({ id: "i2" }))));
  });

  it("remembers food names as suggestions with use count", async () => {
    await as("alice", (m) => call(m.item.add(addArgs({ containerNumber: null }))));
    await as("alice", (m) => call(m.item.add(addArgs({ id: "i2", containerNumber: null, name: "frikadellen", unit: "bag" }))));
    const s = await zdb.run(zql.foodSuggestion.where("freezerId", "f1"));
    expect(s).toHaveLength(1);
    expect(s[0]).toMatchObject({ useCount: 2, lastUnit: "bag" });
  });
});

describe("categories", () => {
  const get = () => zdb.run(zql.item.where("id", "i1").one());
  const update = (over: Record<string, unknown> = {}) => {
    const { freezerId: _f, ...rest } = addArgs(over);
    return rest;
  };

  it("stores the category on the item and remembers it for the food", async () => {
    await as("alice", (m) => call(m.item.add(addArgs({ category: "meat" }))));
    expect((await get())?.category).toBe("meat");
    const [s] = await zdb.run(zql.foodSuggestion.where("freezerId", "f1"));
    expect(s?.lastCategory).toBe("meat");
  });

  it("keeps the remembered category when an older app adds without one", async () => {
    await as("alice", (m) => call(m.item.add(addArgs({ category: "meat", containerNumber: null }))));
    await as("alice", (m) => call(m.item.add(addArgs({ id: "i2", containerNumber: null }))));
    const [s] = await zdb.run(zql.foodSuggestion.where("freezerId", "f1"));
    expect(s?.lastCategory).toBe("meat");
    expect((await zdb.run(zql.item.where("id", "i2").one()))?.category).toBeNull();
    // An explicit null clears it.
    await as("alice", (m) => call(m.item.add(addArgs({ id: "i3", containerNumber: null, category: null }))));
    expect((await zdb.run(zql.foodSuggestion.where("freezerId", "f1")))[0]?.lastCategory).toBeNull();
  });

  it("update changes the category, or leaves it alone when an older app omits it", async () => {
    await as("alice", (m) => call(m.item.add(addArgs({ category: "meat" }))));
    await as("alice", (m) => call(m.item.update(update({ category: "meals" }))));
    expect((await get())?.category).toBe("meals");
    await as("alice", (m) => call(m.item.update(update({ quantity: 2 }))));
    expect(await get()).toMatchObject({ category: "meals", quantity: 2 });
    await as("alice", (m) => call(m.item.update(update({ category: null }))));
    expect((await get())?.category).toBeNull();
  });

  it("rejects unknown categories", async () => {
    await expect(as("alice", (m) => call(m.item.add(addArgs({ category: "snacks" }))))).rejects.toThrow();
  });
});

describe("best-before dates", () => {
  const frozenAt = Date.UTC(2026, 0, 15);
  const get = (id = "i1") => zdb.run(zql.item.where("id", id).one());
  const suggestion = async () => (await zdb.run(zql.foodSuggestion.where("freezerId", "f1")))[0];
  const add = (over: Record<string, unknown> = {}) =>
    as("alice", (m) => call(m.item.add(addArgs({ containerNumber: null, frozenAt, ...over }))));

  it("defaults to the category's storage time, or none", async () => {
    await add({ category: "meat" });
    expect((await get())?.bestBefore).toBe(Date.UTC(2026, 6, 15));
    await add({ id: "i2", name: "Reste", category: "other" });
    expect((await get("i2"))?.bestBefore).toBeNull();
    await add({ id: "i3", name: "Alt" }); // app from before best-before dates: no category, no date
    expect((await get("i3"))?.bestBefore).toBeNull();
  });

  it("keeps a date the app computed and doesn't treat it as a hand-picked one", async () => {
    await add({ category: "meat", bestBefore: Date.UTC(2026, 6, 15) });
    expect((await suggestion())?.shelfLifeMonths).toBeNull();
  });

  it("remembers a hand-picked date as the food's storage time", async () => {
    await add({ category: "meat", bestBefore: Date.UTC(2026, 3, 15) });
    expect((await get())?.bestBefore).toBe(Date.UTC(2026, 3, 15));
    expect((await suggestion())?.shelfLifeMonths).toBe(3);
    // The next item of that food without an explicit date gets the same storage time.
    await add({ id: "i2", category: "meat", frozenAt: Date.UTC(2026, 4, 1) });
    expect((await get("i2"))?.bestBefore).toBe(Date.UTC(2026, 7, 1));
  });

  it("stores an explicit null (no date) without forgetting the storage time", async () => {
    await add({ category: "meat", bestBefore: Date.UTC(2026, 3, 15) });
    await add({ id: "i2", category: "meat", bestBefore: null });
    expect((await get("i2"))?.bestBefore).toBeNull();
    expect((await suggestion())?.shelfLifeMonths).toBe(3);
  });

  it("update sets the date and remembers a hand-picked one; an older app leaves it alone", async () => {
    await add({ category: "meat" });
    const update = (over: Record<string, unknown> = {}) => {
      const { freezerId: _f, ...rest } = addArgs({ containerNumber: null, frozenAt, category: "meat", ...over });
      return rest;
    };
    await as("bob", (m) => call(m.item.update(update({ bestBefore: Date.UTC(2026, 1, 15) }))));
    expect((await get())?.bestBefore).toBe(Date.UTC(2026, 1, 15));
    expect((await suggestion())?.shelfLifeMonths).toBe(1);
    await as("bob", (m) => call(m.item.update(update({ quantity: 1 }))));
    expect((await get())?.bestBefore).toBe(Date.UTC(2026, 1, 15));
  });
});

describe("barcodes", () => {
  const barcodes = () => zdb.run(zql.barcode.where("freezerId", "f1"));

  it("remembers what a scanned product was saved as, and keeps corrections", async () => {
    await as("alice", (m) => call(m.item.add(addArgs({ containerNumber: null, barcode: "4001234567890", name: "Erbsen", unit: "bag", category: "vegetables" }))));
    expect(await barcodes()).toEqual([
      { id: "f1:4001234567890", freezerId: "f1", code: "4001234567890", name: "Erbsen", quantity: 5, unit: "bag", category: "vegetables" },
    ]);
    await as("bob", (m) => call(m.item.add(addArgs({ id: "i2", containerNumber: null, barcode: "4001234567890", name: "Junge Erbsen", quantity: 750, unit: "g", category: "vegetables" }))));
    expect(await barcodes()).toMatchObject([{ name: "Junge Erbsen", quantity: 750, unit: "g" }]);
  });

  it("rejects codes that aren't 8–14 digits", async () => {
    for (const barcode of ["1234567", "123456789012345", "40012345abc"])
      await expect(as("alice", (m) => call(m.item.add(addArgs({ containerNumber: null, barcode }))))).rejects.toThrow();
    expect(await barcodes()).toHaveLength(0);
  });

  it("are part of the freezer detail and deleted with the freezer", async () => {
    await as("alice", (m) => call(m.item.add(addArgs({ containerNumber: null, barcode: "12345678" }))));
    const detail = (await zdb.run(
      mustGetQuery(queries, "freezers.detail").fn({ args: { freezerId: "f1" }, ctx: { userID: "bob" } }) as Parameters<typeof zdb.run>[0],
    )) as { barcodes: unknown[] };
    expect(detail.barcodes).toHaveLength(1);
    await as("alice", (m) => call(m.freezer.delete({ freezerId: "f1" })));
    expect(await barcodes()).toHaveLength(0);
  });
});

describe("import", () => {
  const item = (over: Partial<ImportItem> = {}): ImportItem => ({
    id: crypto.randomUUID(),
    name: "Gulasch",
    quantity: 2,
    unit: "portion",
    category: "meals",
    drawer: "Schublade 1",
    containerNumber: null,
    frozenAt: Date.UTC(2026, 9, 1),
    notes: null,
    ...over,
  });
  const run = (user: string, args: Record<string, unknown>) =>
    as(user, (m) => call(m.freezer.import({ freezerId: "f1", drawers: [], newDrawerIds: [], items: [], ...args })));
  const items = () => zdb.run(zql.item.where("freezerId", "f1"));
  const drawers = () => zdb.run(zql.drawer.where("freezerId", "f1").orderBy("sortOrder", "asc"));

  it("is allowed for members, not for others", async () => {
    await expect(run("eve", { items: [item()] })).rejects.toThrow(/No access/);
    await run("bob", { items: [item()] });
    expect(await items()).toMatchObject([{ name: "Gulasch", createdBy: "bob" }]);
  });

  it("matches drawers by name and creates missing ones", async () => {
    await run("bob", {
      drawers: ["schublade 2", "Tür"],
      newDrawerIds: ["n1", "n2"],
      items: [item({ drawer: "SCHUBLADE 2" }), item({ drawer: "Tür" }), item({ drawer: "" })],
    });
    expect((await drawers()).map((d) => [d.id, d.name, d.sortOrder])).toEqual([
      ["d1", "Schublade 1", 0],
      ["d2", "Schublade 2", 1],
      ["n1", "Tür", 2],
    ]);
    expect((await items()).map((i) => i.drawerId).sort()).toEqual(["d1", "d2", "n1"]);
  });

  it("imports items whose container number is taken without one", async () => {
    await as("alice", (m) => call(m.item.add(addArgs({ containerNumber: 5 }))));
    await run("alice", { items: [item({ containerNumber: 5 }), item({ containerNumber: 6 }), item({ containerNumber: 6 })] });
    expect((await items()).map((i) => i.containerNumber).sort((a, b) => (a ?? Infinity) - (b ?? Infinity))).toEqual([5, 6, null, null]);
  });

  it("fills in best-before dates when the file has none, keeps explicit ones", async () => {
    await run("alice", { items: [item({ id: "a" }), item({ id: "b", bestBefore: null }), item({ id: "c", bestBefore: Date.UTC(2026, 11, 24) })] });
    const byId = Object.fromEntries((await items()).map((i) => [i.id, i.bestBefore]));
    expect(byId).toEqual({ a: Date.UTC(2027, 0, 1), b: null, c: Date.UTC(2026, 11, 24) });
  });

  it("turns CSV food names into suggestions", async () => {
    await run("alice", { items: [item(), item(), item({ name: "Brot", unit: "piece", category: "baked" })] });
    const s = await zdb.run(zql.foodSuggestion.where("freezerId", "f1").orderBy("name", "asc"));
    expect(s.map((x) => [x.name, x.useCount, x.lastCategory])).toEqual([
      ["Brot", 1, "baked"],
      ["Gulasch", 2, "meals"],
    ]);
  });

  it("takes at most MAX_IMPORT_ITEMS rows per call", async () => {
    const many = Array.from({ length: MAX_IMPORT_ITEMS + 1 }, () => item());
    await expect(run("alice", { items: many })).rejects.toThrow();
    expect(await items()).toHaveLength(0);
  });

  it("restores an export as a new freezer, with suggestions and barcodes", async () => {
    await as("alice", (m) => call(m.item.add(addArgs({ category: "meat", barcode: "4001234567890", drawerId: "d2" }))));
    const detail = (await zdb.run(
      mustGetQuery(queries, "freezers.detail").fn({ args: { freezerId: "f1" }, ctx: { userID: "alice" } }) as Parameters<typeof zdb.run>[0],
    )) as Parameters<typeof buildExport>[0];
    const parsed = parseImport(JSON.stringify(buildExport(detail)));

    await as("bob", (m) =>
      call(m.freezer.create({ id: "f9", name: parsed.freezerName!, drawerIds: ["x1", "x2"], drawerNames: parsed.drawers })),
    );
    await as("bob", (m) =>
      call(m.freezer.import({ freezerId: "f9", drawers: parsed.drawers, newDrawerIds: [], items: parsed.items.map((i) => ({ ...i, id: `copy-${i.name}` })), suggestions: parsed.suggestions, barcodes: parsed.barcodes })),
    );
    expect((await zdb.run(zql.drawer.where("freezerId", "f9").orderBy("sortOrder", "asc"))).map((d) => d.name)).toEqual(["Schublade 1", "Schublade 2"]);
    expect(await zdb.run(zql.item.where("freezerId", "f9"))).toMatchObject([
      { name: "Frikadellen", drawerId: "x2", containerNumber: 5, category: "meat", createdBy: "bob" },
    ]);
    expect(await zdb.run(zql.foodSuggestion.where("freezerId", "f9"))).toMatchObject([{ name: "Frikadellen", useCount: 1, lastCategory: "meat" }]);
    expect(await zdb.run(zql.barcode.where("freezerId", "f9"))).toMatchObject([{ code: "4001234567890", name: "Frikadellen" }]);
  });
});

describe("undo (item.putBack)", () => {
  const snapshot = (over: Record<string, unknown> = {}) => {
    const { quantity: _q, ...rest } = addArgs(over);
    return { ...rest, createdAt: 1_700_000_000_000 };
  };
  const putBack = (amount: number, over: Record<string, unknown> = {}) =>
    call(mutators.item.putBack({ snapshot: snapshot(over), amount }));
  const get = (id = "i1") => zdb.run(zql.item.where("id", id).one());

  beforeEach(async () => {
    await as("alice", (m) => call(m.item.add(addArgs())));
  });

  it("restores an item that was taken out completely", async () => {
    await as("bob", (m) => call(m.item.take({ id: "i1", amount: 5 })));
    await as("bob", () => putBack(5));
    expect(await get()).toMatchObject({ name: "Frikadellen", quantity: 5, containerNumber: 5, drawerId: "d1" });
  });

  it("restores a deleted item", async () => {
    await as("bob", (m) => call(m.item.delete({ id: "i1" })));
    await as("bob", () => putBack(5));
    expect((await get())?.quantity).toBe(5);
  });

  it("adds the amount back after a partial take", async () => {
    await as("bob", (m) => call(m.item.take({ id: "i1", amount: 2 })));
    await as("bob", () => putBack(2));
    expect((await get())?.quantity).toBe(5);
  });

  it("stays correct when someone else took some in between", async () => {
    await as("bob", (m) => call(m.item.take({ id: "i1", amount: 2 })));
    await as("alice", (m) => call(m.item.take({ id: "i1", amount: 1 })));
    await as("bob", () => putBack(2));
    expect((await get())?.quantity).toBe(4);
  });

  it("drops the container number if it was reused meanwhile", async () => {
    await as("bob", (m) => call(m.item.take({ id: "i1", amount: 5 })));
    await as("alice", (m) => call(m.item.add(addArgs({ id: "i2", name: "Suppe" }))));
    await as("bob", () => putBack(5));
    expect(await get()).toMatchObject({ quantity: 5, containerNumber: null });
    expect((await get("i2"))?.containerNumber).toBe(5);
  });

  it("restores the category and best-before date", async () => {
    await as("alice", (m) => call(m.item.delete({ id: "i1" })));
    await as("alice", () => putBack(5, { category: "soups", bestBefore: Date.UTC(2027, 0, 1) }));
    expect(await get()).toMatchObject({ category: "soups", bestBefore: Date.UTC(2027, 0, 1) });
  });

  it("sets createdBy from the session and leaves the suggestion's use count alone", async () => {
    await as("alice", (m) => call(m.item.delete({ id: "i1" })));
    await as("bob", () => putBack(5));
    expect((await get())?.createdBy).toBe("bob");
    expect((await zdb.run(zql.foodSuggestion.where("freezerId", "f1")))[0]?.useCount).toBe(1);
  });

  it("is members only", async () => {
    await as("alice", (m) => call(m.item.delete({ id: "i1" })));
    await expect(as("eve", () => putBack(5))).rejects.toThrow(/No access/);
    await as("alice", () => putBack(5));
    await as("alice", (m) => call(m.item.take({ id: "i1", amount: 1 })));
    await expect(as("eve", () => putBack(1))).rejects.toThrow(/No access/);
    expect(await get()).toBeDefined();
  });

  it("rejects a drawer from another freezer", async () => {
    await as("eve", (m) => call(m.freezer.create({ id: "f2", name: "Eve", drawerIds: ["e1"] })));
    await as("alice", (m) => call(m.item.delete({ id: "i1" })));
    await expect(as("alice", () => putBack(5, { drawerId: "e1" }))).rejects.toThrow(/Not found/);
  });
});

// Read permissions: the synced queries, evaluated server-side with a trusted ctx.userID.
describe("queries", () => {
  const run = (name: string, args: unknown, userID: string) =>
    zdb.run(mustGetQuery(queries, name).fn({ args, ctx: { userID } }) as Parameters<typeof zdb.run>[0]);

  beforeEach(async () => {
    await as("alice", (m) => call(m.item.add(addArgs())));
    await zdb.transaction((tx) =>
      tx.mutate.invite.insert({ id: "inv1", freezerId: "f1", token: "secret-token", createdBy: "alice", createdAt: Date.now(), expiresAt: Date.now() + 1e6 }),
    );
  });

  it("a non-member sees nothing", async () => {
    expect(await run("freezers.mine", undefined, "eve")).toEqual([]);
    expect(await run("freezers.detail", { freezerId: "f1" }, "eve")).toBeUndefined();
    expect(await run("freezers.invites", { freezerId: "f1" }, "eve")).toEqual([]);
    expect(await run("items.byContainer", { containerNumber: 5 }, "eve")).toEqual([]);
  });

  it("a member sees the freezer with its items, but no invites", async () => {
    expect(await run("freezers.mine", undefined, "bob")).toHaveLength(1);
    const detail = (await run("freezers.detail", { freezerId: "f1" }, "bob")) as { items: unknown[]; members: unknown[] };
    expect(detail.items).toHaveLength(1);
    expect(detail.members).toHaveLength(2);
    expect(detail).not.toHaveProperty("invites");
    expect(await run("freezers.invites", { freezerId: "f1" }, "bob")).toEqual([]);
    expect(await run("items.byContainer", { containerNumber: 5 }, "bob")).toHaveLength(1);
  });

  it("only the owner receives invite tokens; revoked invites drop out", async () => {
    expect(await run("freezers.invites", { freezerId: "f1" }, "alice")).toMatchObject([{ token: "secret-token" }]);
    await as("alice", (m) => call(m.invite.revoke({ inviteId: "inv1" })));
    expect(await run("freezers.invites", { freezerId: "f1" }, "alice")).toEqual([]);
  });
});

describe("API tokens", () => {
  beforeEach(async () => {
    // Created by the REST API in reality; token_hash isn't part of the Zero schema.
    await db.insert(dbSchema.apiToken).values({ id: "t1", userId: "bob", name: "Home Assistant", tokenHash: "hash", prefix: "fm_abcd", scope: "read", createdAt: new Date() });
  });

  it("only the owner sees and revokes a token", async () => {
    const run = (userID: string) =>
      zdb.run(mustGetQuery(queries, "apiTokens.mine").fn({ args: undefined, ctx: { userID } }) as Parameters<typeof zdb.run>[0]);
    expect(await run("bob")).toMatchObject([{ id: "t1", name: "Home Assistant" }]);
    expect(await run("alice")).toEqual([]);
    await expect(as("alice", (m) => call(m.apiToken.revoke({ id: "t1" })))).rejects.toThrow(/Not found/);
    await as("bob", (m) => call(m.apiToken.revoke({ id: "t1" })));
    expect(await run("bob")).toEqual([]);
  });
});

describe("errors", () => {
  it("carry a code that the client shows in its own language", async () => {
    await as("bob", (m) => call(m.item.add(addArgs({ containerNumber: 5 }))));
    const error = await as("bob", (m) => call(m.item.add(addArgs({ id: "i2", containerNumber: 5 })))).catch((e: unknown) => e);
    expect(errorMessage(de, error as Error & { details?: unknown })).toBe("Behälter 5 ist bereits belegt.");
  });
});
