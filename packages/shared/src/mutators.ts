import { defineMutator, defineMutators, type Transaction } from "@rocicorp/zero";
import { z } from "zod";
import "./context";
import type { ZeroContext } from "./context";
import { MAX_DRAWERS, suggestionId, UNITS } from "./domain";
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

async function requireContainerFree(tx: Tx, freezerId: string, containerNumber: number, exceptItemId?: string) {
  const occupant = await tx.run(
    zql.item.where("freezerId", freezerId).where("containerNumber", containerNumber).one(),
  );
  if (occupant && occupant.id !== exceptItemId) throw appError("containerInUse", containerNumber);
}

const id = z.string().min(1).max(64);
const name = z.string().trim().min(1).max(100);
const unit = z.enum(UNITS);
const quantity = z.number().positive().max(100_000);
const containerNumber = z.number().int().positive().max(1_000_000).nullable();

export const mutators = defineMutators({
  freezer: {
    create: defineMutator(
      // locale: language of the default drawer names (optional for clients from before it existed).
      z.object({ id, name, drawerIds: z.array(id).min(1).max(MAX_DRAWERS), locale: z.enum(LOCALES).optional() }),
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
          await tx.mutate.drawer.insert({ id: drawerId, freezerId: args.id, name: messages[args.locale ?? "de"].drawerName(i + 1), sortOrder: i });
        }
      },
    ),

    delete: defineMutator(z.object({ freezerId: id }), async ({ tx, ctx, args }) => {
      await requireRole(tx, ctx, args.freezerId, "owner");
      const f = args.freezerId;
      for (const row of await tx.run(zql.item.where("freezerId", f))) await tx.mutate.item.delete({ id: row.id });
      for (const row of await tx.run(zql.foodSuggestion.where("freezerId", f)))
        await tx.mutate.foodSuggestion.delete({ id: row.id });
      for (const row of await tx.run(zql.invite.where("freezerId", f))) await tx.mutate.invite.delete({ id: row.id });
      for (const row of await tx.run(zql.drawer.where("freezerId", f))) await tx.mutate.drawer.delete({ id: row.id });
      for (const row of await tx.run(zql.freezerMember.where("freezerId", f)))
        await tx.mutate.freezerMember.delete({ freezerId: f, userId: row.userId });
      await tx.mutate.freezer.delete({ id: f });
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
        frozenAt: z.number().int(),
        notes: z.string().trim().max(500).nullable(),
      }),
      async ({ tx, ctx, args }) => {
        await requireRole(tx, ctx, args.freezerId);
        await requireDrawerInFreezer(tx, args.drawerId, args.freezerId);
        if (args.containerNumber !== null) await requireContainerFree(tx, args.freezerId, args.containerNumber);

        await tx.mutate.item.insert({
          ...args,
          notes: args.notes || null,
          createdBy: ctx.userID,
          createdAt: Date.now(),
        });

        const sid = suggestionId(args.freezerId, args.name);
        const existing = await tx.run(zql.foodSuggestion.where("id", sid).one());
        await tx.mutate.foodSuggestion.upsert({
          id: sid,
          freezerId: args.freezerId,
          name: args.name,
          lastUnit: args.unit,
          useCount: (existing?.useCount ?? 0) + 1,
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
        frozenAt: z.number().int(),
        notes: z.string().trim().max(500).nullable(),
      }),
      async ({ tx, ctx, args }) => {
        const item = await requireItem(tx, ctx, args.id);
        await requireDrawerInFreezer(tx, args.drawerId, item.freezerId);
        if (args.containerNumber !== null)
          await requireContainerFree(tx, item.freezerId, args.containerNumber, item.id);
        await tx.mutate.item.update({ ...args, notes: args.notes || null });
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
