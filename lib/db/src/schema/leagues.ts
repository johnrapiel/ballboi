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
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow().$onUpdate(() => new Date()),
});

export const insertLeagueSchema = createInsertSchema(leaguesTable).omit({ id: true, createdAt: true, updatedAt: true });
export type InsertLeague = z.infer<typeof insertLeagueSchema>;
export type League = typeof leaguesTable.$inferSelect;
