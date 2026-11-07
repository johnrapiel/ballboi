import { index, integer, pgTable, serial, text, timestamp } from "drizzle-orm/pg-core";
import { directoryCourtsTable } from "./courtDirectory";
import { matchesTable } from "./matches";

// Setting up a match in chat (F2, F12, F13; Wave 2 Session F). A player
// sends a match card ("Add this match?") from a chat; the other says
// "I'm in" or "Can't make it". A newer card replaces an older one. Once
// added, the match is a real match row (no league), and this plan carries
// the day-before check, reminders, "Did it happen?" and any no-show report.
// Migration 20261108_f_match_plans.sql.

export const MATCH_PLAN_STATUSES = ["proposed", "replaced", "declined", "accepted", "undone", "canceled", "not_played"] as const;
export type MatchPlanStatus = (typeof MATCH_PLAN_STATUSES)[number];
export const NO_SHOW_STATUSES = ["pending", "confirmed", "disputed"] as const;
export type NoShowStatus = (typeof NO_SHOW_STATUSES)[number];

export const matchPlansTable = pgTable(
  "match_plans",
  {
    id: serial("id").primaryKey(),
    /** The two players, low:high clerk ids, so a pair's cards are one list. */
    pairKey: text("pair_key").notNull(),
    proposerClerkUserId: text("proposer_clerk_user_id").notNull(),
    recipientClerkUserId: text("recipient_clerk_user_id").notNull(),
    startsAt: timestamp("starts_at", { withTimezone: true }).notNull(),
    /** The proposer's time zone, for "tomorrow at 6 PM" in reminders. */
    timeZone: text("time_zone").notNull().default("America/New_York"),
    courtId: integer("court_id").references(() => directoryCourtsTable.id, { onDelete: "set null" }),
    /** Kept so a removed court still reads right on old cards. */
    courtName: text("court_name"),
    /** singles | practice ("Practice hit"). */
    kind: text("kind").notNull().default("singles"),
    status: text("status").$type<MatchPlanStatus>().notNull().default("proposed"),
    matchId: integer("match_id").references(() => matchesTable.id, { onDelete: "set null" }),
    respondedAt: timestamp("responded_at", { withTimezone: true }),
    endedAt: timestamp("ended_at", { withTimezone: true }),
    endedByClerkUserId: text("ended_by_clerk_user_id"),
    proposerStillOnAt: timestamp("proposer_still_on_at", { withTimezone: true }),
    recipientStillOnAt: timestamp("recipient_still_on_at", { withTimezone: true }),
    dayBeforeSentAt: timestamp("day_before_sent_at", { withTimezone: true }),
    reminderSentAt: timestamp("reminder_sent_at", { withTimezone: true }),
    didItHappenSentAt: timestamp("did_it_happen_sent_at", { withTimezone: true }),
    noShowReporterClerkUserId: text("no_show_reporter_clerk_user_id"),
    noShowClerkUserId: text("no_show_clerk_user_id"),
    noShowReportedAt: timestamp("no_show_reported_at", { withTimezone: true }),
    noShowStatus: text("no_show_status").$type<NoShowStatus>(),
    noShowAnsweredAt: timestamp("no_show_answered_at", { withTimezone: true }),
    noShowExpirySentAt: timestamp("no_show_expiry_sent_at", { withTimezone: true }),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    index("idx_match_plans_pair").on(table.pairKey, table.createdAt),
    index("idx_match_plans_starts").on(table.status, table.startsAt),
    index("idx_match_plans_no_show").on(table.noShowClerkUserId),
  ],
);

export type MatchPlan = typeof matchPlansTable.$inferSelect;
