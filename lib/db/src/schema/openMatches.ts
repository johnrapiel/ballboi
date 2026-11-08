import { boolean, index, integer, pgTable, real, serial, text, timestamp, uniqueIndex } from "drizzle-orm/pg-core";
import { directoryCourtsTable } from "./courtDirectory";
import { matchesTable } from "./matches";

// Open matches (spec: Discover > Open matches; F6; brief items 38 to 46).
// A player posts a day and time window, format, spots, level range, court
// and note. Others near them join, first come, first served; when the last
// spot fills, everyone moves into a group chat and the match goes on their
// schedules. Need 1 / Need 2 is a tag on doubles posts, not a section.
// Migration 20261108_f_open_matches.sql.

export const OPEN_MATCH_STATUSES = ["open", "full", "canceled"] as const;
export type OpenMatchStatus = (typeof OPEN_MATCH_STATUSES)[number];

export const openMatchesTable = pgTable(
  "open_matches",
  {
    id: serial("id").primaryKey(),
    posterClerkUserId: text("poster_clerk_user_id").notNull(),
    startsAt: timestamp("starts_at", { withTimezone: true }).notNull(),
    endsAt: timestamp("ends_at", { withTimezone: true }).notNull(),
    timeZone: text("time_zone").notNull().default("America/New_York"),
    courtId: integer("court_id").references(() => directoryCourtsTable.id, { onDelete: "set null" }),
    courtName: text("court_name"),
    /** singles | doubles */
    format: text("format").notNull().default("singles"),
    /** Spots for others: 1 for singles, 1 to 3 for doubles. */
    spots: integer("spots").notNull().default(1),
    minRating: real("min_rating"),
    maxRating: real("max_rating"),
    note: text("note"),
    status: text("status").$type<OpenMatchStatus>().notNull().default("open"),
    /** The poster's home ZIP center when posted: approximate, never an address. */
    areaLatitude: real("area_latitude").notNull(),
    areaLongitude: real("area_longitude").notNull(),
    matchId: integer("match_id").references(() => matchesTable.id, { onDelete: "set null" }),
    filledAt: timestamp("filled_at", { withTimezone: true }),
    canceledAt: timestamp("canceled_at", { withTimezone: true }),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [index("idx_open_matches_area").on(t.status, t.areaLatitude, t.areaLongitude), index("idx_open_matches_poster").on(t.posterClerkUserId)],
);

/** in: holds a spot. dropped: left. removed: the poster took them off (they only ever hear "it filled up"). */
export const openMatchPlayersTable = pgTable(
  "open_match_players",
  {
    id: serial("id").primaryKey(),
    openMatchId: integer("open_match_id")
      .notNull()
      .references(() => openMatchesTable.id, { onDelete: "cascade" }),
    clerkUserId: text("clerk_user_id").notNull(),
    status: text("status").notNull().default("in"),
    joinedAt: timestamp("joined_at", { withTimezone: true }).notNull().defaultNow(),
    leftAt: timestamp("left_at", { withTimezone: true }),
    /** A removed player hasn't seen "This match filled up" yet. */
    noticePending: boolean("notice_pending").notNull().default(false),
  },
  (t) => [uniqueIndex("uq_open_match_players").on(t.openMatchId, t.clerkUserId), index("idx_open_match_players_user").on(t.clerkUserId)],
);

/** "Alerts for new posts": each alert sent, for the 2-a-day cap. */
export const openMatchAlertsTable = pgTable(
  "open_match_alerts",
  {
    id: serial("id").primaryKey(),
    clerkUserId: text("clerk_user_id").notNull(),
    openMatchId: integer("open_match_id").notNull(),
    sentAt: timestamp("sent_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [index("idx_open_match_alerts_user").on(t.clerkUserId, t.sentAt)],
);

export type OpenMatch = typeof openMatchesTable.$inferSelect;
export type OpenMatchPlayer = typeof openMatchPlayersTable.$inferSelect;
