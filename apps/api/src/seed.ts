// Dev seed: `pnpm db:seed --email you@example.com` (run after your first login).
// Creates a demo freezer "Keller" owned by that user.
import { suggestionId } from "@freezer/shared/domain";
import { de } from "@freezer/shared/i18n";
import { eq } from "drizzle-orm";
import { randomUUID } from "node:crypto";
import { parseArgs } from "node:util";
import { db, schema, sql } from "./db";

const { values } = parseArgs({ options: { email: { type: "string" } } });
if (!values.email) throw new Error("Usage: pnpm db:seed --email you@example.com");

const [owner] = await db.select().from(schema.user).where(eq(schema.user.email, values.email));
if (!owner) throw new Error(`No user with email ${values.email}. Log in once via Pocket ID first.`);

const freezerId = randomUUID();
const now = new Date();
const daysAgo = (d: number) => new Date(Date.now() - d * 86_400_000).toISOString().slice(0, 10);

await db.transaction(async (tx) => {
  await tx.insert(schema.freezer).values({ id: freezerId, name: "Keller", ownerId: owner.id, createdAt: now });
  await tx.insert(schema.freezerMember).values({ freezerId, userId: owner.id, role: "owner", joinedAt: now });

  const drawers = Array.from({ length: 5 }, (_, i) => ({
    id: randomUUID(),
    freezerId,
    name: de.drawerName(i + 1),
    sortOrder: i,
  }));
  await tx.insert(schema.drawer).values(drawers);

  const items: [string, number, string, number, number | null][] = [
    ["Frikadellen", 5, "piece", 12, 1],
    ["Chili con Carne", 2, "portion", 40, 2],
    ["Erbsen", 450, "g", 90, null],
    ["Brötchen", 6, "piece", 5, null],
    ["Lasagne", 1, "portion", 150, 3],
    ["Himbeeren", 1, "bag", 200, null],
    ["Hühnerbrühe", 1, "l", 30, 4],
    ["Pizzateig", 2, "piece", 60, 5],
    ["Spinat", 300, "g", 400, null],
    ["Gulasch", 3, "portion", 20, 6],
  ];
  for (const [i, [name, quantity, unit, age, containerNumber]] of items.entries()) {
    await tx.insert(schema.item).values({
      id: randomUUID(),
      freezerId,
      drawerId: drawers[i % drawers.length]!.id,
      containerNumber,
      name,
      quantity,
      unit,
      frozenAt: daysAgo(age),
      createdBy: owner.id,
      createdAt: now,
    });
    await tx
      .insert(schema.foodSuggestion)
      .values({ id: suggestionId(freezerId, name), freezerId, name, lastUnit: unit, useCount: 1 })
      .onConflictDoNothing();
  }
});

console.log(`Seeded freezer "Keller" for ${owner.email}.`);
await sql.end();
