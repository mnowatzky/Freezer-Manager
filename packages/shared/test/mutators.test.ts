import { PGlite } from "@electric-sql/pglite";
import { zeroDrizzle } from "@rocicorp/zero/server/adapters/drizzle";
import { drizzle } from "drizzle-orm/pglite";
import { readFileSync } from "node:fs";
import { beforeEach, describe, expect, it } from "vitest";
import * as dbSchema from "../src/db-schema";
import { todayAsDate } from "../src/domain";
import { mutators } from "../src/mutators";
import { schema, zql } from "../src/zero-schema.gen";

// Runs the mutators the way the API does: server-side transactions against Postgres (PGlite).
const migration = readFileSync(new URL("../../../apps/api/drizzle/0000_init.sql", import.meta.url), "utf8");

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

  it("non-member cannot add items", async () => {
    await expect(as("eve", (m) => call(m.item.add(addArgs())))).rejects.toThrow(/Kein Zugriff/);
  });

  it("non-member cannot take from or delete an item", async () => {
    await as("bob", (m) => call(m.item.add(addArgs())));
    await expect(as("eve", (m) => call(m.item.take({ id: "i1", amount: 1 })))).rejects.toThrow(/Kein Zugriff/);
    await expect(as("eve", (m) => call(m.item.delete({ id: "i1" })))).rejects.toThrow(/Kein Zugriff/);
  });

  it("member cannot remove others or delete the freezer", async () => {
    await expect(as("bob", (m) => call(m.member.remove({ freezerId: "f1", userId: "alice" })))).rejects.toThrow(
      /Besitzer/,
    );
    await expect(as("bob", (m) => call(m.freezer.delete({ freezerId: "f1" })))).rejects.toThrow(/Besitzer/);
  });

  it("owner can remove a member; member can leave; owner cannot leave", async () => {
    await expect(as("alice", (m) => call(m.member.leave({ freezerId: "f1" })))).rejects.toThrow(/Besitzer/);
    await as("bob", (m) => call(m.member.leave({ freezerId: "f1" })));
    expect(await zdb.run(zql.freezerMember.where("userId", "bob"))).toHaveLength(0);
  });

  it("rejects a drawer from another freezer", async () => {
    await as("eve", (m) => call(m.freezer.create({ id: "f2", name: "Eve", drawerIds: ["e1"] })));
    await expect(as("alice", (m) => call(m.item.add(addArgs({ drawerId: "e1" }))))).rejects.toThrow(/Nicht gefunden/);
  });
});

describe("items", () => {
  it("container number is unique per freezer", async () => {
    await as("alice", (m) => call(m.item.add(addArgs())));
    await expect(as("bob", (m) => call(m.item.add(addArgs({ id: "i2" }))))).rejects.toThrow(/Behälter 5/);
    // Same number in another freezer is fine.
    await as("eve", (m) => call(m.freezer.create({ id: "f2", name: "Eve", drawerIds: ["e1"] })));
    await as("eve", (m) => call(m.item.add(addArgs({ id: "i3", freezerId: "f2", drawerId: "e1" }))));
  });

  it("take reduces quantity and deletes at zero, freeing the container", async () => {
    await as("alice", (m) => call(m.item.add(addArgs())));
    await as("bob", (m) => call(m.item.take({ id: "i1", amount: 3 })));
    expect((await zdb.run(zql.item.where("id", "i1").one()))?.quantity).toBe(2);
    await expect(as("bob", (m) => call(m.item.take({ id: "i1", amount: 3 })))).rejects.toThrow(/Ungültige Menge/);
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
