import { boolean, index, integer, pgTable, real, text, timestamp } from "drizzle-orm/pg-core";
import { directoryCourtsTable } from "./courtDirectory";

// Discover (spec: Discover; Wave 2, Session F). One row per account that
// has been placed in Discover, kept apart from `users` so Discover's settings
// and the point it measures from live in one place.
//
// The point is always the center of the player's home ZIP (F5: no travel
// mode, location is only a ZIP shortcut), rounded, never an exact spot. It
// follows `users.home_zip`: Discover re-reads it whenever the two differ.

export const discoverProfilesTable = pgTable(
  "discover_profiles",
  {
    clerkUserId: text("clerk_user_id").primaryKey(),
    /** "Show me in Discover" off: out of Players near you, Quick match and New message search. */
    hidden: boolean("hidden").notNull().default(false),
    /** singles | doubles | both. Null until the player says. */
    plays: text("plays"),
    /** Last distance picked, 1 to 30 miles. One distance for all three tabs. */
    radiusMiles: integer("radius_miles").notNull().default(10),
    /** The ZIP this point came from, to notice when the home area changes. */
    areaZip: text("area_zip"),
    /** Town for "Near 12590, Wappingers Falls" and the player card. Never finer. */
    areaTown: text("area_town"),
    areaState: text("area_state"),
    areaLatitude: real("area_latitude"),
    areaLongitude: real("area_longitude"),
    /** Optional home court from the court directory, shown on the player card (migration 20261108_f_court_directory.sql). */
    homeCourtId: integer("home_court_id").references(() => directoryCourtsTable.id, { onDelete: "set null" }),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow().$onUpdate(() => new Date()),
  },
  (table) => [index("idx_discover_profiles_area").on(table.areaLatitude, table.areaLongitude)],
);

export type DiscoverProfile = typeof discoverProfilesTable.$inferSelect;
