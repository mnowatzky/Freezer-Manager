import { relations } from "drizzle-orm";
import {
  boolean,
  date,
  doublePrecision,
  index,
  integer,
  pgTable,
  primaryKey,
  text,
  timestamp,
  unique,
} from "drizzle-orm/pg-core";

// ---------------------------------------------------------------------------
// Better Auth tables (user/session/account/verification).
// Shape follows the Better Auth core schema; only `user` is synced to Zero.
// ---------------------------------------------------------------------------

export const user = pgTable("user", {
  id: text("id").primaryKey(),
  name: text("name").notNull(),
  email: text("email").notNull().unique(),
  emailVerified: boolean("email_verified").notNull().default(false),
  image: text("image"),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
});

export const session = pgTable(
  "session",
  {
    id: text("id").primaryKey(),
    expiresAt: timestamp("expires_at", { withTimezone: true }).notNull(),
    token: text("token").notNull().unique(),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
    ipAddress: text("ip_address"),
    userAgent: text("user_agent"),
    userId: text("user_id")
      .notNull()
      .references(() => user.id, { onDelete: "cascade" }),
  },
  (t) => [index("session_user_id_idx").on(t.userId)],
);

export const account = pgTable(
  "account",
  {
    id: text("id").primaryKey(),
    accountId: text("account_id").notNull(),
    providerId: text("provider_id").notNull(),
    userId: text("user_id")
      .notNull()
      .references(() => user.id, { onDelete: "cascade" }),
    accessToken: text("access_token"),
    refreshToken: text("refresh_token"),
    idToken: text("id_token"),
    accessTokenExpiresAt: timestamp("access_token_expires_at", { withTimezone: true }),
    refreshTokenExpiresAt: timestamp("refresh_token_expires_at", { withTimezone: true }),
    scope: text("scope"),
    password: text("password"),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [index("account_user_id_idx").on(t.userId)],
);

export const verification = pgTable(
  "verification",
  {
    id: text("id").primaryKey(),
    identifier: text("identifier").notNull(),
    value: text("value").notNull(),
    expiresAt: timestamp("expires_at", { withTimezone: true }).notNull(),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [index("verification_identifier_idx").on(t.identifier)],
);

// ---------------------------------------------------------------------------
// App tables. IDs are client-generated strings (Zero requirement).
// ---------------------------------------------------------------------------

export const freezer = pgTable("freezer", {
  id: text("id").primaryKey(),
  name: text("name").notNull(),
  ownerId: text("owner_id")
    .notNull()
    .references(() => user.id),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull(),
});

export const freezerMember = pgTable(
  "freezer_member",
  {
    freezerId: text("freezer_id")
      .notNull()
      .references(() => freezer.id, { onDelete: "cascade" }),
    userId: text("user_id")
      .notNull()
      .references(() => user.id, { onDelete: "cascade" }),
    role: text("role").$type<"owner" | "member">().notNull(),
    joinedAt: timestamp("joined_at", { withTimezone: true }).notNull(),
  },
  (t) => [primaryKey({ columns: [t.freezerId, t.userId] }), index("freezer_member_user_idx").on(t.userId)],
);

export const drawer = pgTable(
  "drawer",
  {
    id: text("id").primaryKey(),
    freezerId: text("freezer_id")
      .notNull()
      .references(() => freezer.id, { onDelete: "cascade" }),
    name: text("name").notNull(),
    sortOrder: integer("sort_order").notNull(),
  },
  (t) => [index("drawer_freezer_idx").on(t.freezerId)],
);

// A container is identified by its sticker number within a freezer; it holds at most one item.
// There is no separate container table: an item "occupies" a container via containerNumber.
export const item = pgTable(
  "item",
  {
    id: text("id").primaryKey(),
    freezerId: text("freezer_id")
      .notNull()
      .references(() => freezer.id, { onDelete: "cascade" }),
    drawerId: text("drawer_id")
      .notNull()
      .references(() => drawer.id),
    containerNumber: integer("container_number"),
    name: text("name").notNull(),
    quantity: doublePrecision("quantity").notNull(),
    unit: text("unit").notNull(),
    frozenAt: date("frozen_at", { mode: "string" }).notNull(),
    notes: text("notes"),
    createdBy: text("created_by")
      .notNull()
      .references(() => user.id),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull(),
  },
  (t) => [
    unique("item_freezer_container_uq").on(t.freezerId, t.containerNumber),
    index("item_freezer_idx").on(t.freezerId),
  ],
);

// Remembered food names per freezer. id = `${freezerId}:${lowercased name}` so upserts are idempotent.
export const foodSuggestion = pgTable(
  "food_suggestion",
  {
    id: text("id").primaryKey(),
    freezerId: text("freezer_id")
      .notNull()
      .references(() => freezer.id, { onDelete: "cascade" }),
    name: text("name").notNull(),
    lastUnit: text("last_unit").notNull(),
    useCount: integer("use_count").notNull(),
  },
  (t) => [index("food_suggestion_freezer_idx").on(t.freezerId)],
);

export const invite = pgTable(
  "invite",
  {
    id: text("id").primaryKey(),
    freezerId: text("freezer_id")
      .notNull()
      .references(() => freezer.id, { onDelete: "cascade" }),
    token: text("token").notNull().unique(),
    createdBy: text("created_by")
      .notNull()
      .references(() => user.id),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull(),
    expiresAt: timestamp("expires_at", { withTimezone: true }).notNull(),
    revokedAt: timestamp("revoked_at", { withTimezone: true }),
    // Pocket ID signup link for people without an account (null if unavailable).
    signupUrl: text("signup_url"),
  },
  (t) => [index("invite_freezer_idx").on(t.freezerId)],
);

// ---------------------------------------------------------------------------
// Relations (drizzle-zero turns these into Zero relationships)
// ---------------------------------------------------------------------------

export const userRelations = relations(user, ({ many }) => ({
  memberships: many(freezerMember),
}));

export const freezerRelations = relations(freezer, ({ many }) => ({
  members: many(freezerMember),
  drawers: many(drawer),
  items: many(item),
  suggestions: many(foodSuggestion),
  invites: many(invite),
}));

export const freezerMemberRelations = relations(freezerMember, ({ one }) => ({
  freezer: one(freezer, { fields: [freezerMember.freezerId], references: [freezer.id] }),
  user: one(user, { fields: [freezerMember.userId], references: [user.id] }),
}));

export const drawerRelations = relations(drawer, ({ one, many }) => ({
  freezer: one(freezer, { fields: [drawer.freezerId], references: [freezer.id] }),
  items: many(item),
}));

export const itemRelations = relations(item, ({ one }) => ({
  freezer: one(freezer, { fields: [item.freezerId], references: [freezer.id] }),
  drawer: one(drawer, { fields: [item.drawerId], references: [drawer.id] }),
}));

export const foodSuggestionRelations = relations(foodSuggestion, ({ one }) => ({
  freezer: one(freezer, { fields: [foodSuggestion.freezerId], references: [freezer.id] }),
}));

export const inviteRelations = relations(invite, ({ one }) => ({
  freezer: one(freezer, { fields: [invite.freezerId], references: [freezer.id] }),
}));
