import { index, pgTable, real, serial, text, timestamp } from "drizzle-orm/pg-core";

// The court directory (spec: Discover > Court directory; F4). One shared,
// searchable list of courts, separate from the legacy per-league `courts`
// table. Players add a missing court with a name and an address. A court's
// point is the center of its address's ZIP: Discover only ever shows an
// approximate distance ("Beacon Courts · ~3 mi"). No map.
// Migration 20261108_f_court_directory.sql.

export const directoryCourtsTable = pgTable(
  "directory_courts",
  {
    id: serial("id").primaryKey(),
    name: text("name").notNull(),
    /** As the player typed it, ZIP included: "Memorial Park, Beacon NY 12508". */
    address: text("address").notNull(),
    zip: text("zip").notNull(),
    town: text("town"),
    latitude: real("latitude").notNull(),
    longitude: real("longitude").notNull(),
    /** Who added it. Their additions go when they delete their account. */
    addedByClerkUserId: text("added_by_clerk_user_id"),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [index("idx_directory_courts_point").on(table.latitude, table.longitude)],
);

export type DirectoryCourt = typeof directoryCourtsTable.$inferSelect;
