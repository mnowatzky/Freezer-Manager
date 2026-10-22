// Dev seed: `pnpm db:seed --email you@example.com` (run after your first login).
// Creates a demo freezer "Keller" owned by that user.
import { suggestionId, type Category } from "@freezer/shared/domain";
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

  const items: [string, number, string, number, number | null, Category][] = [
    ["Frikadellen", 5, "piece", 12, 1, "meat"],
    ["Chili con Carne", 2, "portion", 40, 2, "meals"],
    ["Erbsen", 450, "g", 90, null, "vegetables"],
    ["Brötchen", 6, "piece", 5, null, "baked"],
    ["Lasagne", 1, "portion", 150, 3, "meals"],
    ["Himbeeren", 1, "bag", 200, null, "fruit"],
    ["Hühnerbrühe", 1, "l", 30, 4, "soups"],
    ["Pizzateig", 2, "piece", 60, 5, "baked"],
    ["Spinat", 300, "g", 400, null, "vegetables"],
    ["Gulasch", 3, "portion", 20, 6, "meals"],
  ];
  for (const [i, [name, quantity, unit, age, containerNumber, category]] of items.entries()) {
    await tx.insert(schema.item).values({
      id: randomUUID(),
      freezerId,
      drawerId: drawers[i % drawers.length]!.id,
      containerNumber,
      name,
      quantity,
      unit,
      frozenAt: daysAgo(age),
      category,
      createdBy: owner.id,
      createdAt: now,
    });
    await tx
      .insert(schema.foodSuggestion)
      .values({ id: suggestionId(freezerId, name), freezerId, name, lastUnit: unit, lastCategory: category, useCount: 1 })
      .onConflictDoNothing();
  }
});

console.log(`Seeded freezer "Keller" for ${owner.email}.`);
await sql.end();
