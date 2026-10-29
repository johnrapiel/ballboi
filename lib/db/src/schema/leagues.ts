import { pgTable, text, serial, timestamp, integer } from "drizzle-orm/pg-core";
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
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow().$onUpdate(() => new Date()),
});

export const insertLeagueSchema = createInsertSchema(leaguesTable).omit({ id: true, createdAt: true, updatedAt: true });
export type InsertLeague = z.infer<typeof insertLeagueSchema>;
export type League = typeof leaguesTable.$inferSelect;
