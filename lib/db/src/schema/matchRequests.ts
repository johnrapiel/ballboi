import { index, integer, pgTable, serial, text, timestamp } from "drizzle-orm/pg-core";

// Match requests (spec: Discover, "From found to playing": a request holds
// date and time window, court, singles or practice hit, optional note; the
// recipient accepts, counters with a new time, or declines; both players
// confirm the day before; reminder 2 hours out; reliability shows no-shows).
// Migration 20261105_f_match_requests.sql.

export const MATCH_REQUEST_KINDS = ["singles", "practice"] as const;
export const MATCH_REQUEST_STATUSES = ["pending", "accepted", "declined", "withdrawn", "cancelled"] as const;
export type MatchRequestKind = (typeof MATCH_REQUEST_KINDS)[number];
export type MatchRequestStatus = (typeof MATCH_REQUEST_STATUSES)[number];

export const matchRequestsTable = pgTable(
  "match_requests",
  {
    id: serial("id").primaryKey(),
    fromClerkUserId: text("from_clerk_user_id").notNull(),
    toClerkUserId: text("to_clerk_user_id").notNull(),
    /** The time on the table now: the request's, or the latest counter. YYYY-MM-DD and HH:MM in `timeZone`. */
    date: text("date").notNull(),
    windowStart: text("window_start").notNull(),
    windowEnd: text("window_end").notNull(),
    timeZone: text("time_zone").notNull(),
    /** A court from the court directory, or none ("we'll pick"). */
    courtId: integer("court_id"),
    kind: text("kind").$type<MatchRequestKind>().notNull().default("singles"),
    note: text("note"),
    status: text("status").$type<MatchRequestStatus>().notNull().default("pending"),
    /** Whose answer it's waiting on while pending: the recipient, or the sender after a counter. */
    waitingOnClerkUserId: text("waiting_on_clerk_user_id").notNull(),
    counters: integer("counters").notNull().default(0),
    /** The match made when it was accepted. Either player enters its score. */
    matchId: integer("match_id"),
    fromConfirmedAt: timestamp("from_confirmed_at", { withTimezone: true }),
    toConfirmedAt: timestamp("to_confirmed_at", { withTimezone: true }),
    /** At-most-once pushes: claimed before sending. */
    confirmPromptSentAt: timestamp("confirm_prompt_sent_at", { withTimezone: true }),
    reminderSentAt: timestamp("reminder_sent_at", { withTimezone: true }),
    /** Who didn't show, as the other player said. Shown as reliability, never restricts anyone. */
    noShowClerkUserId: text("no_show_clerk_user_id"),
    /** Who cancelled an accepted match, and when. */
    cancelledByClerkUserId: text("cancelled_by_clerk_user_id"),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [index("idx_match_requests_from").on(t.fromClerkUserId), index("idx_match_requests_to").on(t.toClerkUserId)],
);

export type MatchRequestRow = typeof matchRequestsTable.$inferSelect;
