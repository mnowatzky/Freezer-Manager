import { PGlite } from "@electric-sql/pglite";
import { mustGetQuery } from "@rocicorp/zero";
import { zeroDrizzle } from "@rocicorp/zero/server/adapters/drizzle";
import { drizzle } from "drizzle-orm/pglite";
import { readFileSync } from "node:fs";
import { beforeEach, describe, expect, it } from "vitest";
import * as dbSchema from "../src/db-schema";
import { todayAsDate } from "../src/domain";
import { de, errorMessage } from "../src/i18n";
import { mutators } from "../src/mutators";
import { queries } from "../src/queries";
import { schema, zql } from "../src/zero-schema.gen";

// Runs the mutators and queries the way the API does: server-side, against Postgres (PGlite)
// with every Drizzle migration applied in journal order.
const migrationsDir = new URL("../../../apps/api/drizzle/", import.meta.url);
const journal = JSON.parse(readFileSync(new URL("meta/_journal.json", migrationsDir), "utf8")) as { entries: { tag: string }[] };
const migrations = journal.entries.map((e) => readFileSync(new URL(`${e.tag}.sql`, migrationsDir), "utf8"));

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
  const db = drizzle(pg, { schema: dbSchema });
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

  it("restores the category", async () => {
    await as("alice", (m) => call(m.item.delete({ id: "i1" })));
    await as("alice", () => putBack(5, { category: "soups" }));
    expect((await get())?.category).toBe("soups");
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

describe("errors", () => {
  it("carry a code that the client shows in its own language", async () => {
    await as("bob", (m) => call(m.item.add(addArgs({ containerNumber: 5 }))));
    const error = await as("bob", (m) => call(m.item.add(addArgs({ id: "i2", containerNumber: 5 })))).catch((e: unknown) => e);
    expect(errorMessage(de, error as Error & { details?: unknown })).toBe("Behälter 5 ist bereits belegt.");
  });
});
