import { index, integer, jsonb, pgTable, serial, text, timestamp, uniqueIndex } from "drizzle-orm/pg-core";
import { matchesTable } from "./matches";

// Live Activity on both phones (Wave 2, Session G; acceptance 31 to 35).
//
// - live_sessions: one per match while the mounted phone is set up or
//   recording. The mounted phone writes what the Live Activity shows (props,
//   built on the phone from lib/coachLines.ts so captions are never retyped)
//   and picks up a Start or Stop sent from the other player's Lock Screen or
//   second phone (pending_command). Ended when the recording stops or the
//   recorder leaves.
// - live_activity_tokens: Apple's tokens for Live Activities. "start" is a
//   phone's push-to-start token (one per phone, so the API can open the Live
//   Activity on the opponent's phone, G7). "activity" is one running Live
//   Activity's update token, tied to the session it shows. Deleted with the
//   account (acceptance 41).

export const liveSessionsTable = pgTable(
  "live_sessions",
  {
    id: serial("id").primaryKey(),
    matchId: integer("match_id")
      .notNull()
      .references(() => matchesTable.id, { onDelete: "cascade" }),
    recorderClerkUserId: text("recorder_clerk_user_id").notNull(),
    /** "active" while setting up or recording; "ended" after. */
    status: text("status").notNull().default("active"),
    /** What the Live Activity shows, as the mounted phone last sent it. */
    props: jsonb("props").notNull(),
    /** "start" or "stop" from another phone, waiting for the mounted phone. */
    pendingCommand: text("pending_command"),
    commandByClerkUserId: text("command_by_clerk_user_id"),
    commandAt: timestamp("command_at", { withTimezone: true }),
    /** Accounts the Live Activity was pushed to, so each gets it at most once. */
    startedFor: text("started_for").array().notNull().default([]),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
    endedAt: timestamp("ended_at", { withTimezone: true }),
  },
  (table) => [
    index("idx_live_sessions_match").on(table.matchId),
    index("idx_live_sessions_recorder").on(table.recorderClerkUserId),
  ],
);

export type LiveSession = typeof liveSessionsTable.$inferSelect;

export const liveActivityTokensTable = pgTable(
  "live_activity_tokens",
  {
    id: serial("id").primaryKey(),
    clerkUserId: text("clerk_user_id").notNull(),
    /** "start" (push-to-start, one per phone) or "activity" (one running Live Activity). */
    kind: text("kind").notNull(),
    token: text("token").notNull(),
    /** The running Live Activity's id on the phone ("activity" only). */
    activityId: text("activity_id"),
    sessionId: integer("session_id").references(() => liveSessionsTable.id, { onDelete: "cascade" }),
    /** "production" or "sandbox", once a push has gone through; null until then. */
    apnsEnv: text("apns_env"),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    uniqueIndex("live_activity_tokens_token_unique").on(table.token),
    index("idx_live_activity_tokens_user").on(table.clerkUserId),
    index("idx_live_activity_tokens_session").on(table.sessionId),
  ],
);

export type LiveActivityToken = typeof liveActivityTokensTable.$inferSelect;
