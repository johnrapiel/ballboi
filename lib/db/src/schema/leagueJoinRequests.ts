import { sql } from "drizzle-orm";
import { pgTable, text, serial, timestamp, integer, index, uniqueIndex } from "drizzle-orm/pg-core";
import { leaguesTable } from "./leagues";

// Requests to join an Open league before its season starts, and the waitlist
// for next season once a league is locked or full (decision 26).
// Migration 20261029_league_rules.sql.

export const JOIN_REQUEST_KINDS = ["request", "waitlist"] as const;
export const JOIN_REQUEST_STATUSES = ["pending", "approved", "declined", "withdrawn"] as const;
export type JoinRequestKind = (typeof JOIN_REQUEST_KINDS)[number];
export type JoinRequestStatus = (typeof JOIN_REQUEST_STATUSES)[number];

export const leagueJoinRequestsTable = pgTable(
  "league_join_requests",
  {
    id: serial("id").primaryKey(),
    leagueId: integer("league_id").notNull().references(() => leaguesTable.id, { onDelete: "cascade" }),
    clerkUserId: text("clerk_user_id").notNull(),
    playerName: text("player_name").notNull(),
    skillLevel: text("skill_level").notNull().default("3.0"),
    kind: text("kind").$type<JoinRequestKind>().notNull().default("request"),
    status: text("status").$type<JoinRequestStatus>().notNull().default("pending"),
    decidedByClerkUserId: text("decided_by_clerk_user_id"),
    decidedAt: timestamp("decided_at", { withTimezone: true }),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    uniqueIndex("uq_league_join_requests_pending")
      .on(table.leagueId, table.clerkUserId)
      .where(sql`status = 'pending'`),
    index("idx_league_join_requests_league").on(table.leagueId, table.status),
  ],
);

export type LeagueJoinRequest = typeof leagueJoinRequestsTable.$inferSelect;
