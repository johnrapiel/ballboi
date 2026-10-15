import { pgTable, text, serial, timestamp, integer, boolean, index } from "drizzle-orm/pg-core";
import { createInsertSchema } from "drizzle-zod";
import { z } from "zod/v4";
import { leaguesTable } from "./leagues";

export const leagueInvitesTable = pgTable("league_invites", {
  id: serial("id").primaryKey(),
  code: text("code").notNull().unique(),
  leagueId: integer("league_id").notNull().references(() => leaguesTable.id, { onDelete: "cascade" }),
  createdByClerkUserId: text("created_by_clerk_user_id").notNull(),
  expiresAt: text("expires_at"),
  maxUses: integer("max_uses"),
  usageCount: integer("usage_count").notNull().default(0),
  isActive: boolean("is_active").notNull().default(true),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
}, (table) => [
  index("idx_league_invites_league_id").on(table.leagueId),
]);

export const insertLeagueInviteSchema = createInsertSchema(leagueInvitesTable).omit({ id: true, createdAt: true, usageCount: true });
export type InsertLeagueInvite = z.infer<typeof insertLeagueInviteSchema>;
export type LeagueInvite = typeof leagueInvitesTable.$inferSelect;
