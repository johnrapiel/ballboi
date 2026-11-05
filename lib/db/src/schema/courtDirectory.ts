import { boolean, index, integer, pgTable, real, serial, text, timestamp } from "drizzle-orm/pg-core";

// The court directory (spec: Discover > Court directory: "public and club
// courts with surface, lights, and court count; players can add missing
// courts. Feeds home court, match requests, and open matches"). One shared
// list, separate from the legacy per-league `courts` table.
// Migration 20261105_f_court_directory.sql.

export const COURT_ACCESS = ["public", "club"] as const;
export const COURT_SURFACES = ["hard", "clay", "grass", "other"] as const;
export type CourtAccess = (typeof COURT_ACCESS)[number];
export type CourtSurface = (typeof COURT_SURFACES)[number];

export const directoryCourtsTable = pgTable(
  "directory_courts",
  {
    id: serial("id").primaryKey(),
    name: text("name").notNull(),
    /** Optional cross streets or park name, like "Riverside Park, W 96th St". */
    place: text("place"),
    zip: text("zip").notNull(),
    latitude: real("latitude").notNull(),
    longitude: real("longitude").notNull(),
    access: text("access").$type<CourtAccess>().notNull().default("public"),
    surface: text("surface").$type<CourtSurface>(),
    lights: boolean("lights"),
    courtCount: integer("court_count"),
    /** Who added it. Cleared when they delete their account; the court stays. */
    addedByClerkUserId: text("added_by_clerk_user_id"),
    /** A moderator hid it after a report. */
    hiddenAt: timestamp("hidden_at", { withTimezone: true }),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [index("idx_directory_courts_point").on(table.latitude, table.longitude)],
);

export type DirectoryCourt = typeof directoryCourtsTable.$inferSelect;
