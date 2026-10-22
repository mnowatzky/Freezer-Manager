import { defineMutator, defineMutators, type Transaction } from "@rocicorp/zero";
import { z } from "zod";
import "./context";
import type { ZeroContext } from "./context";
import { barcodeId, defaultBestBefore, MAX_DRAWERS, monthsBetween, shelfLifeMonths, suggestionId } from "./domain";
import { barcode as barcodeField, category as categoryField, containerNumber, date, id, name, notes, quantity, unit } from "./fields";
import { drawerKey, importArgs, planDrawers } from "./import";
import { appError, LOCALES, messages } from "./i18n";
import { zql } from "./zero-schema.gen";

// Custom mutators run optimistically on the client and authoritatively on the
// server (via /api/zero/mutate). All permission checks live here and use the
// trusted ctx.userID; on the server, reads see the full database.

type Tx = Transaction;

async function requireRole(tx: Tx, ctx: ZeroContext, freezerId: string, role?: "owner") {
  const member = await tx.run(
    zql.freezerMember.where("freezerId", freezerId).where("userId", ctx.userID).one(),
  );
  if (!member) throw appError("notMember");
  if (role === "owner" && member.role !== "owner") throw appError("notOwner");
  return member;
}

async function requireItem(tx: Tx, ctx: ZeroContext, itemId: string) {
  const item = await tx.run(zql.item.where("id", itemId).one());
  if (!item) throw appError("notFound");
  await requireRole(tx, ctx, item.freezerId);
  return item;
}

async function requireDrawerInFreezer(tx: Tx, drawerId: string, freezerId: string) {
  const drawer = await tx.run(zql.drawer.where("id", drawerId).one());
  if (!drawer || drawer.freezerId !== freezerId) throw appError("notFound");
}

async function requireContainerFree(tx: Tx, freezerId: string, number: number, exceptItemId?: string) {
  const occupant = await tx.run(zql.item.where("freezerId", freezerId).where("containerNumber", number).one());
  if (occupant && occupant.id !== exceptItemId) throw appError("containerInUse", number);
}

// Optional so that app versions from before categories existed keep working; undefined = unchanged.
const categoryArg = categoryField.optional();
// Same for best-before dates; on add, undefined = the food's default.
const bestBeforeArg = date.nullable().optional();

type Suggestion = { shelfLifeMonths: number | null; lastCategory: string | null } | undefined;

/**
 * A best-before date that differs from the food's default was picked by hand: remember the storage
 * time it implies, so the next item of that food gets the same. Returns the months to store.
 */
function chosenShelfLife(
  suggestion: Suggestion,
  category: string | null | undefined,
  frozenAt: number,
  bestBefore: number | null,
): number | null {
  const remembered = suggestion?.shelfLifeMonths ?? null;
  if (bestBefore === null || bestBefore <= frozenAt) return remembered;
  const fallback = defaultBestBefore(frozenAt, shelfLifeMonths(remembered, category));
  return bestBefore === fallback ? remembered : monthsBetween(frozenAt, bestBefore);
}

export const mutators = defineMutators({
  freezer: {
    create: defineMutator(
      // locale: language of the default drawer names (optional for clients from before it existed).
      // drawerNames: names instead of the defaults (importing an export as a new freezer).
      z.object({
        id,
        name,
        drawerIds: z.array(id).min(1).max(MAX_DRAWERS),
        locale: z.enum(LOCALES).optional(),
        drawerNames: z.array(name).max(MAX_DRAWERS).optional(),
      }),
      async ({ tx, ctx, args }) => {
        const now = Date.now();
        await tx.mutate.freezer.insert({ id: args.id, name: args.name, ownerId: ctx.userID, createdAt: now });
        await tx.mutate.freezerMember.insert({
          freezerId: args.id,
          userId: ctx.userID,
          role: "owner",
          joinedAt: now,
        });
        for (const [i, drawerId] of args.drawerIds.entries()) {
          await tx.mutate.drawer.insert({
            id: drawerId,
            freezerId: args.id,
            name: args.drawerNames?.[i] ?? messages[args.locale ?? "de"].drawerName(i + 1),
            sortOrder: i,
          });
        }
      },
    ),

    delete: defineMutator(z.object({ freezerId: id }), async ({ tx, ctx, args }) => {
      await requireRole(tx, ctx, args.freezerId, "owner");
      const f = args.freezerId;
      for (const row of await tx.run(zql.item.where("freezerId", f))) await tx.mutate.item.delete({ id: row.id });
      for (const row of await tx.run(zql.foodSuggestion.where("freezerId", f)))
        await tx.mutate.foodSuggestion.delete({ id: row.id });
      for (const row of await tx.run(zql.barcode.where("freezerId", f))) await tx.mutate.barcode.delete({ id: row.id });
      for (const row of await tx.run(zql.invite.where("freezerId", f))) await tx.mutate.invite.delete({ id: row.id });
      for (const row of await tx.run(zql.drawer.where("freezerId", f))) await tx.mutate.drawer.delete({ id: row.id });
      for (const row of await tx.run(zql.freezerMember.where("freezerId", f)))
        await tx.mutate.freezerMember.delete({ freezerId: f, userId: row.userId });
      await tx.mutate.freezer.delete({ id: f });
    }),

    // Import from an export file or CSV (see import.ts), allowed for every member. Drawers are matched
    // by name and created if missing (up to MAX_DRAWERS; items for drawers beyond that go to the first
    // drawer). Container numbers that are already taken are dropped. At most MAX_IMPORT_ITEMS rows per
    // call; the client splits larger files.
    import: defineMutator(importArgs, async ({ tx, ctx, args }) => {
      const f = args.freezerId;
      await requireRole(tx, ctx, f);

      const drawers = await tx.run(zql.drawer.where("freezerId", f).orderBy("sortOrder", "asc"));
      const drawerIds = new Map(drawers.map((d) => [drawerKey(d.name), d.id]));
      let sortOrder = Math.max(-1, ...drawers.map((d) => d.sortOrder));
      for (const [i, drawerName] of planDrawers(drawers.map((d) => d.name), args.drawers).create.entries()) {
        const drawerId = args.newDrawerIds[i];
        if (!drawerId) break;
        await tx.mutate.drawer.insert({ id: drawerId, freezerId: f, name: drawerName, sortOrder: ++sortOrder });
        drawerIds.set(drawerKey(drawerName), drawerId);
      }
      const firstDrawer = drawers[0]?.id ?? [...drawerIds.values()][0];
      if (!firstDrawer && args.items.length) throw appError("notFound");

      const taken = new Set((await tx.run(zql.item.where("freezerId", f))).flatMap((i) => (i.containerNumber === null ? [] : [i.containerNumber])));
      const suggestions = new Map((await tx.run(zql.foodSuggestion.where("freezerId", f))).map((s) => [s.id, s]));
      const now = Date.now();

      for (const item of args.items) {
        let container = item.containerNumber;
        if (container !== null) {
          if (taken.has(container)) container = null;
          else taken.add(container);
        }
        const sid = suggestionId(f, item.name);
        const known = suggestions.get(sid);
        await tx.mutate.item.insert({
          id: item.id,
          freezerId: f,
          drawerId: drawerIds.get(drawerKey(item.drawer)) ?? firstDrawer!,
          containerNumber: container,
          name: item.name,
          quantity: item.quantity,
          unit: item.unit,
          category: item.category,
          frozenAt: item.frozenAt,
          bestBefore:
            item.bestBefore !== undefined
              ? item.bestBefore
              : defaultBestBefore(item.frozenAt, shelfLifeMonths(known?.shelfLifeMonths, item.category)),
          notes: item.notes || null,
          createdBy: ctx.userID,
          createdAt: now,
        });
        // A CSV has no suggestions of its own: its food names become suggestions, as when freezing.
        if (!args.suggestions) {
          const next = {
            id: sid,
            freezerId: f,
            name: known?.name ?? item.name,
            lastUnit: item.unit,
            lastCategory: item.category ?? known?.lastCategory ?? null,
            shelfLifeMonths: known?.shelfLifeMonths ?? null,
            useCount: (known?.useCount ?? 0) + 1,
          };
          await tx.mutate.foodSuggestion.upsert(next);
          suggestions.set(sid, next);
        }
      }

      for (const s of args.suggestions ?? []) {
        const sid = suggestionId(f, s.name);
        const known = suggestions.get(sid);
        await tx.mutate.foodSuggestion.upsert({
          id: sid,
          freezerId: f,
          name: known?.name ?? s.name,
          lastUnit: s.lastUnit,
          lastCategory: s.lastCategory,
          shelfLifeMonths: s.shelfLifeMonths ?? known?.shelfLifeMonths ?? null,
          useCount: Math.max(known?.useCount ?? 0, s.useCount),
        });
      }
      for (const b of args.barcodes ?? [])
        await tx.mutate.barcode.upsert({ id: barcodeId(f, b.code), freezerId: f, ...b });
    }),
  },

  member: {
    leave: defineMutator(z.object({ freezerId: id }), async ({ tx, ctx, args }) => {
      const me = await requireRole(tx, ctx, args.freezerId);
      if (me.role === "owner") throw appError("ownerCannotLeave");
      await tx.mutate.freezerMember.delete({ freezerId: args.freezerId, userId: ctx.userID });
    }),

    remove: defineMutator(z.object({ freezerId: id, userId: id }), async ({ tx, ctx, args }) => {
      await requireRole(tx, ctx, args.freezerId, "owner");
      if (args.userId === ctx.userID) throw appError("ownerCannotLeave");
      await tx.mutate.freezerMember.delete({ freezerId: args.freezerId, userId: args.userId });
    }),
  },

  // Invites are created and accepted via the REST API (they need server-only
  // data: random tokens and the Pocket ID signup link). Revoking is a plain update.
  invite: {
    revoke: defineMutator(z.object({ inviteId: id }), async ({ tx, ctx, args }) => {
      const inv = await tx.run(zql.invite.where("id", args.inviteId).one());
      if (!inv) throw appError("notFound");
      await requireRole(tx, ctx, inv.freezerId, "owner");
      await tx.mutate.invite.update({ id: inv.id, revokedAt: Date.now() });
    }),
  },

  item: {
    add: defineMutator(
      z.object({
        id,
        freezerId: id,
        drawerId: id,
        containerNumber,
        name,
        quantity,
        unit,
        frozenAt: date,
        notes,
        category: categoryArg,
        bestBefore: bestBeforeArg,
        // Scanned product code: remembered with the name, quantity, unit and category this item was saved with.
        barcode: barcodeField.optional(),
      }),
      async ({ tx, ctx, args }) => {
        await requireRole(tx, ctx, args.freezerId);
        await requireDrawerInFreezer(tx, args.drawerId, args.freezerId);
        if (args.containerNumber !== null) await requireContainerFree(tx, args.freezerId, args.containerNumber);

        const sid = suggestionId(args.freezerId, args.name);
        const existing = await tx.run(zql.foodSuggestion.where("id", sid).one());
        const category = args.category ?? null;
        const best =
          args.bestBefore !== undefined
            ? args.bestBefore
            : defaultBestBefore(args.frozenAt, shelfLifeMonths(existing?.shelfLifeMonths, category));

        const { barcode, ...fields } = args;
        await tx.mutate.item.insert({
          ...fields,
          notes: args.notes || null,
          category,
          bestBefore: best,
          createdBy: ctx.userID,
          createdAt: Date.now(),
        });

        await tx.mutate.foodSuggestion.upsert({
          id: sid,
          freezerId: args.freezerId,
          name: args.name,
          lastUnit: args.unit,
          lastCategory: args.category === undefined ? (existing?.lastCategory ?? null) : args.category,
          shelfLifeMonths: chosenShelfLife(existing, category, args.frozenAt, best),
          useCount: (existing?.useCount ?? 0) + 1,
        });

        if (barcode)
          await tx.mutate.barcode.upsert({
            id: barcodeId(args.freezerId, barcode),
            freezerId: args.freezerId,
            code: barcode,
            name: args.name,
            quantity: args.quantity,
            unit: args.unit,
            category,
          });
      },
    ),

    update: defineMutator(
      z.object({
        id,
        drawerId: id,
        containerNumber,
        name,
        quantity,
        unit,
        frozenAt: date,
        notes,
        category: categoryArg,
        bestBefore: bestBeforeArg,
      }),
      async ({ tx, ctx, args }) => {
        const item = await requireItem(tx, ctx, args.id);
        await requireDrawerInFreezer(tx, args.drawerId, item.freezerId);
        if (args.containerNumber !== null)
          await requireContainerFree(tx, item.freezerId, args.containerNumber, item.id);
        await tx.mutate.item.update({ ...args, notes: args.notes || null });

        if (args.bestBefore !== undefined) {
          const s = await tx.run(zql.foodSuggestion.where("id", suggestionId(item.freezerId, args.name)).one());
          const months = chosenShelfLife(s, args.category === undefined ? item.category : args.category, args.frozenAt, args.bestBefore);
          if (s && months !== s.shelfLifeMonths) await tx.mutate.foodSuggestion.update({ id: s.id, shelfLifeMonths: months });
        }
      },
    ),

    // Take some (or all) of an item out. Reaching zero deletes the item and frees its container.
    take: defineMutator(z.object({ id, amount: quantity }), async ({ tx, ctx, args }) => {
      const item = await requireItem(tx, ctx, args.id);
      const remaining = Math.round((item.quantity - args.amount) * 1000) / 1000;
      if (remaining < 0) throw appError("invalidAmount");
      if (remaining === 0) await tx.mutate.item.delete({ id: item.id });
      else await tx.mutate.item.update({ id: item.id, quantity: remaining });
    }),

    delete: defineMutator(z.object({ id }), async ({ tx, ctx, args }) => {
      await requireItem(tx, ctx, args.id);
      await tx.mutate.item.delete({ id: args.id });
    }),

    // Undo for take/delete: puts `amount` back. If the item still exists (a partial take, possibly
    // with more taken by someone else since), its quantity grows; otherwise the snapshot is
    // re-inserted. A container number that was reused meanwhile is dropped instead of failing
    // (Zero mutators can't return values, so the client checks for that itself to tell the user).
    putBack: defineMutator(
      z.object({
        snapshot: z.object({
          id,
          freezerId: id,
          drawerId: id,
          containerNumber,
          name,
          unit,
          frozenAt: date,
          notes,
          category: categoryArg,
          bestBefore: bestBeforeArg,
          createdAt: date,
        }),
        amount: quantity,
      }),
      async ({ tx, ctx, args: { snapshot, amount } }) => {
        await requireRole(tx, ctx, snapshot.freezerId);
        const existing = await tx.run(zql.item.where("id", snapshot.id).one());
        if (existing) {
          if (existing.freezerId !== snapshot.freezerId) throw appError("notFound");
          const total = Math.round((existing.quantity + amount) * 1000) / 1000;
          if (total > 100_000) throw appError("invalidAmount");
          await tx.mutate.item.update({ id: existing.id, quantity: total });
          return;
        }

        await requireDrawerInFreezer(tx, snapshot.drawerId, snapshot.freezerId);
        let container = snapshot.containerNumber;
        if (container !== null) {
          const occupant = await tx.run(
            zql.item.where("freezerId", snapshot.freezerId).where("containerNumber", container).one(),
          );
          if (occupant) container = null;
        }
        // createdBy comes from the session, never from the (client-supplied) snapshot.
        // The food suggestion is left alone: putting something back isn't a new use.
        await tx.mutate.item.insert({
          ...snapshot,
          containerNumber: container,
          quantity: amount,
          notes: snapshot.notes || null,
          category: snapshot.category ?? null,
          bestBefore: snapshot.bestBefore ?? null,
          createdBy: ctx.userID,
        });
      },
    ),
  },

  // API tokens are created via the REST API (the token is generated and hashed on the server and
  // shown once). Revoking is a plain update, only by the token's owner.
  apiToken: {
    revoke: defineMutator(z.object({ id }), async ({ tx, ctx, args }) => {
      const token = await tx.run(zql.apiToken.where("id", args.id).one());
      if (!token || token.userId !== ctx.userID) throw appError("notFound");
      await tx.mutate.apiToken.update({ id: token.id, revokedAt: Date.now() });
    }),
  },

  suggestion: {
    delete: defineMutator(z.object({ id: z.string().min(1).max(200) }), async ({ tx, ctx, args }) => {
      const s = await tx.run(zql.foodSuggestion.where("id", args.id).one());
      if (!s) return;
      await requireRole(tx, ctx, s.freezerId);
      await tx.mutate.foodSuggestion.delete({ id: args.id });
    }),
  },
});

export type Mutators = typeof mutators;
