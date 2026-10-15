import { pgTable, text, serial, timestamp, integer } from "drizzle-orm/pg-core";
import { createInsertSchema } from "drizzle-zod";
import { z } from "zod/v4";
import { leaguesTable } from "./leagues";

export const seasonsTable = pgTable("seasons", {
  id: serial("id").primaryKey(),
  leagueId: integer("league_id").references(() => leaguesTable.id, { onDelete: "cascade" }),
  name: text("name").notNull(),
  startDate: text("start_date").notNull(),
  endDate: text("end_date").notNull(),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow().$onUpdate(() => new Date()),
});

export const insertSeasonSchema = createInsertSchema(seasonsTable).omit({ id: true, createdAt: true, updatedAt: true });
export type InsertSeason = z.infer<typeof insertSeasonSchema>;
export type Season = typeof seasonsTable.$inferSelect;
