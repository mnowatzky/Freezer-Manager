import { defineQueries, defineQuery } from "@rocicorp/zero";
import { z } from "zod";
import "./context";
import { zql } from "./zero-schema.gen";

// Every query is scoped to freezers the user is a member of. `ctx.userID` comes
// from the validated session on the server and cannot be forged by the client.
export const queries = defineQueries({
  freezers: {
    mine: defineQuery(({ ctx }) =>
      zql.freezer.whereExists("members", (m) => m.where("userId", ctx.userID)).orderBy("createdAt", "asc"),
    ),
    detail: defineQuery(z.object({ freezerId: z.string() }), ({ args, ctx }) =>
      zql.freezer
        .where("id", args.freezerId)
        .whereExists("members", (m) => m.where("userId", ctx.userID))
        .related("drawers", (d) => d.orderBy("sortOrder", "asc"))
        .related("items", (i) => i.orderBy("frozenAt", "asc").orderBy("createdAt", "asc"))
        .related("suggestions", (s) => s.orderBy("useCount", "desc"))
        .related("barcodes")
        .related("members", (m) => m.related("user").orderBy("joinedAt", "asc"))
        .one(),
    ),
    // Invite tokens and Pocket ID signup links are owner-only: they let people join and create
    // accounts, so they are synced to the freezer's owner and to nobody else.
    invites: defineQuery(z.object({ freezerId: z.string() }), ({ args, ctx }) =>
      zql.invite
        .where("freezerId", args.freezerId)
        .where("revokedAt", "IS", null)
        .whereExists("freezer", (f) =>
          f.whereExists("members", (m) => m.where("userId", ctx.userID).where("role", "owner")),
        )
        .orderBy("createdAt", "desc"),
    ),
  },
  // The user's own active API tokens (never the token hash, which isn't synced at all).
  apiTokens: {
    mine: defineQuery(({ ctx }) =>
      zql.apiToken.where("userId", ctx.userID).where("revokedAt", "IS", null).orderBy("createdAt", "desc"),
    ),
  },
  items: {
    // Scan target: which of my freezers currently holds container #n?
    byContainer: defineQuery(z.object({ containerNumber: z.number().int() }), ({ args, ctx }) =>
      zql.item
        .where("containerNumber", args.containerNumber)
        .whereExists("freezer", (f) => f.whereExists("members", (m) => m.where("userId", ctx.userID))),
    ),
  },
});
