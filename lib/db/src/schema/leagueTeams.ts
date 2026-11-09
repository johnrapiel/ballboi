import { index, integer, pgTable, primaryKey, serial, text, timestamp } from "drizzle-orm/pg-core";
import { leaguesTable } from "./leagues";
import { playersTable } from "./players";

// Doubles partners (Wave 2, doubles flow review D1 to D10, Nov 9).
// Migration 20261109_x_doubles_partners.sql.

/**
 * Fixed-partner doubles teams (D2, D4): two players who play every round of
 * the season together. Made when a team-up request is accepted, by an admin
 * in Manage, or automatically when the first round goes out. A team is never
 * deleted while it has results: splitting it or a partner leaving sets
 * dissolvedAt, so its played matches still name it. Each player is on at
 * most one active team.
 */
export const leagueTeamsTable = pgTable(
  "league_teams",
  {
    id: serial("id").primaryKey(),
    leagueId: integer("league_id").notNull().references(() => leaguesTable.id, { onDelete: "cascade" }),
    player1Id: integer("player1_id").notNull().references(() => playersTable.id, { onDelete: "cascade" }),
    player2Id: integer("player2_id").notNull().references(() => playersTable.id, { onDelete: "cascade" }),
    /** request | admin | auto */
    madeBy: text("made_by").notNull().default("request"),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    dissolvedAt: timestamp("dissolved_at", { withTimezone: true }),
    /** split (an admin split it) | partner_left (one of them left the league) */
    dissolvedReason: text("dissolved_reason"),
  },
  (table) => [
    index("idx_league_teams_league_id").on(table.leagueId),
    index("idx_league_teams_player1_id").on(table.player1Id),
    index("idx_league_teams_player2_id").on(table.player2Id),
  ],
);

/**
 * "Team up with someone" (D9): a request from one member without a partner
 * to another. pending until Accept or Decline; unanswered after 48 hours it
 * expires. Declined or expired returns the sender to "Looking for a partner"
 * with a notice in words, shown until they dismiss it (noticeSeenAt).
 */
export const leaguePartnerRequestsTable = pgTable(
  "league_partner_requests",
  {
    id: serial("id").primaryKey(),
    leagueId: integer("league_id").notNull().references(() => leaguesTable.id, { onDelete: "cascade" }),
    fromPlayerId: integer("from_player_id").notNull().references(() => playersTable.id, { onDelete: "cascade" }),
    toPlayerId: integer("to_player_id").notNull().references(() => playersTable.id, { onDelete: "cascade" }),
    /** pending | accepted | declined | expired | cancelled */
    status: text("status").notNull().default("pending"),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    respondedAt: timestamp("responded_at", { withTimezone: true }),
    noticeSeenAt: timestamp("notice_seen_at", { withTimezone: true }),
  },
  (table) => [
    index("idx_league_partner_requests_league_id").on(table.leagueId),
    index("idx_league_partner_requests_status").on(table.status),
  ],
);

/**
 * At-most-once log for the cards a doubles match's group chat holds (D6):
 * the day before ("day_before") and "Did it happen?" ("did_it_happen").
 */
export const leagueMatchChatCardsTable = pgTable(
  "league_match_chat_cards",
  {
    matchId: integer("match_id").notNull(),
    kind: text("kind").notNull(),
    sentAt: timestamp("sent_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [primaryKey({ columns: [table.matchId, table.kind] })],
);

export type LeagueTeam = typeof leagueTeamsTable.$inferSelect;
export type LeaguePartnerRequest = typeof leaguePartnerRequestsTable.$inferSelect;
