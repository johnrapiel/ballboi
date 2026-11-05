import { pgTable, text, serial, timestamp, integer, real } from "drizzle-orm/pg-core";
import { createInsertSchema } from "drizzle-zod";
import { z } from "zod/v4";

export const leaguesTable = pgTable("leagues", {
  id: serial("id").primaryKey(),
  name: text("name").notNull(),
  description: text("description"),
  format: text("format").notNull().default("round_robin"),
  status: text("status").notNull().default("active"),
  leagueType: text("league_type").notNull().default("singles"),
  startDate: text("start_date"),
  endDate: text("end_date"),
  location: text("location"),
  createdByClerkUserId: text("created_by_clerk_user_id"),
  // Setup options (spec: Leagues > Setup). Migration 20261021_league_setup.sql.
  visibility: text("visibility").notNull().default("private"), // private | open
  partnerMode: text("partner_mode"), // doubles only: fixed | rotating
  minRating: text("min_rating"), // Open leagues: eligibility range, NTRP scale
  maxRating: text("max_rating"),
  rosterCap: integer("roster_cap"),
  seasonWeeks: integer("season_weeks"), // 1 to 24
  playoffSize: integer("playoff_size").notNull().default(0), // 0, 4, or 8
  unplayedRule: text("unplayed_rule").notNull().default("no_result"), // forfeit | no_result
  // An admin ended the league (decision 31): standings freeze, unpublished
  // rounds are cancelled, and it moves to Past. Migration 20261101_c_league_end_and_notices.sql.
  endedAt: timestamp("ended_at", { withTimezone: true }),
  // League match times (migration 20261104_league_match_times.sql).
  // The league's days run on its creator's time zone: pairing at 7am, week
  // starts and ends, and score deadlines. IANA name, e.g. America/Los_Angeles.
  timeZone: text("time_zone").notNull().default("America/New_York"),
  // A club's weekly match day and time, set by an admin. Both null means
  // players pick their own time each week. matchDay: 0 Sunday to 6 Saturday;
  // matchTime: 24-hour "HH:MM" in the league's time zone.
  matchDay: integer("match_day"),
  matchTime: text("match_time"),
  // Where an Open league shows in Discover (spec: Discover): its creator's
  // home area point when the league was made, never an exact address.
  // Migration 20261105_f_discover_open_leagues.sql.
  areaLatitude: real("area_latitude"),
  areaLongitude: real("area_longitude"),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow().$onUpdate(() => new Date()),
});

export const insertLeagueSchema = createInsertSchema(leaguesTable).omit({ id: true, createdAt: true, updatedAt: true });
export type InsertLeague = z.infer<typeof insertLeagueSchema>;
export type League = typeof leaguesTable.$inferSelect;
