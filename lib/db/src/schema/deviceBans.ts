import { index, integer, pgTable, serial, text, timestamp, uniqueIndex } from "drizzle-orm/pg-core";

// DeviceCheck device bans (Wave 2, Session G; acceptance 38).
//
// Apple keeps two bits per iPhone for Ball Boi, and they survive deleting and
// reinstalling the app. Ball Boi sets the first bit when a moderator bans an
// account, so that phone can't be used for a new account. Apple never tells
// Ball Boi which phone is which; the app sends a fresh DeviceCheck token when
// it opens, and the server asks Apple about that token.
//
// - device_check_tokens: each account's latest token, so a ban can mark the
//   phone it was used on. Deleted with the account.
// - device_bans: the admin queue's record of each phone ban, with undo.
//   "banned": a moderator banned the account and its phone was marked.
//   "caught": a new account on a marked phone was banned automatically.
//   Kept after account deletion (acceptance 41), holding no Apple token.

export const deviceCheckTokensTable = pgTable(
  "device_check_tokens",
  {
    id: serial("id").primaryKey(),
    clerkUserId: text("clerk_user_id").notNull(),
    token: text("token").notNull(),
    /** "production" or "development": the DeviceCheck server this phone's tokens work with. */
    appleEnv: text("apple_env"),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [uniqueIndex("device_check_tokens_user_unique").on(table.clerkUserId)],
);

export type DeviceCheckToken = typeof deviceCheckTokensTable.$inferSelect;

export const deviceBansTable = pgTable(
  "device_bans",
  {
    id: serial("id").primaryKey(),
    /** The account the ban is about. */
    clerkUserId: text("clerk_user_id").notNull(),
    /** "banned" (marked by a moderator's ban) or "caught" (a new account on a marked phone). */
    kind: text("kind").notNull(),
    /** The account ban it goes with, so lifting one lifts the other. */
    sanctionId: integer("sanction_id"),
    /** Did Apple confirm the phone was marked (or, for "caught", that it already was)? */
    phoneMarked: text("phone_marked").notNull().default("no"),
    reason: text("reason").notNull(),
    createdBy: text("created_by").notNull(),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    liftedAt: timestamp("lifted_at", { withTimezone: true }),
    liftedBy: text("lifted_by"),
  },
  (table) => [
    index("idx_device_bans_user").on(table.clerkUserId),
    index("idx_device_bans_sanction").on(table.sanctionId),
  ],
);

export type DeviceBan = typeof deviceBansTable.$inferSelect;
