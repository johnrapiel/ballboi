import { pgTable, text, serial, timestamp, index, uniqueIndex, integer, jsonb } from "drizzle-orm/pg-core";

// App Store guideline 1.2: apps where people meet and message need a way to
// report objectionable content and block abusive users.
// Spec: Messaging and moderation.

export const userBlocksTable = pgTable(
  "user_blocks",
  {
    id: serial("id").primaryKey(),
    blockerClerkUserId: text("blocker_clerk_user_id").notNull(),
    blockedClerkUserId: text("blocked_clerk_user_id").notNull(),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    uniqueIndex("uq_user_blocks_pair").on(table.blockerClerkUserId, table.blockedClerkUserId),
    index("idx_user_blocks_blocked").on(table.blockedClerkUserId),
  ],
);

// "message": a direct message, with a snapshot of the conversation around it.
// "account": filed by auto-restrict or Stream moderation, not by a person.
export const REPORT_TARGET_TYPES = ["player", "league", "ball_boi_session", "match", "message", "account"] as const;
export const REPORT_REASONS = ["harassment", "inappropriate_content", "impersonation", "spam", "cheating", "other"] as const;
export const REPORT_STATUSES = ["open", "reviewed", "actioned", "dismissed"] as const;
/** user: a person reported it. auto: auto-restrict fired. stream: Stream moderation flagged it. */
export const REPORT_SOURCES = ["user", "auto", "stream"] as const;

export type ReportTargetType = (typeof REPORT_TARGET_TYPES)[number];
export type ReportReason = (typeof REPORT_REASONS)[number];
export type ReportStatus = (typeof REPORT_STATUSES)[number];

export const contentReportsTable = pgTable(
  "content_reports",
  {
    id: serial("id").primaryKey(),
    // Null once the reporter deletes their account; the report stays for moderation.
    reporterClerkUserId: text("reporter_clerk_user_id"),
    targetType: text("target_type").notNull(),
    targetId: text("target_id").notNull(),
    reason: text("reason").notNull(),
    details: text("details"),
    status: text("status").notNull().default("open"),
    source: text("source").notNull().default("user"),
    /** The account the report is about, when known. Used to count distinct reporters. */
    subjectClerkUserId: text("subject_clerk_user_id"),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    reviewedAt: timestamp("reviewed_at", { withTimezone: true }),
  },
  (table) => [
    index("idx_content_reports_status").on(table.status, table.createdAt),
    index("idx_content_reports_subject").on(table.subjectClerkUserId),
  ],
);

/** What a moderator sees for a message report: the reported message and the ones before it. */
export interface SnapshotMessage {
  id: string;
  senderClerkUserId: string;
  senderName: string;
  text: string;
  at: string;
  reported: boolean;
}

export const messageReportSnapshotsTable = pgTable("message_report_snapshots", {
  id: serial("id").primaryKey(),
  reportId: integer("report_id")
    .notNull()
    .references(() => contentReportsTable.id, { onDelete: "cascade" }),
  conversationId: integer("conversation_id"),
  messages: jsonb("messages").$type<SnapshotMessage[]>().notNull(),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
});

export const RESTRICTION_SOURCES = ["auto", "stream", "agent", "admin"] as const;
export type RestrictionSource = (typeof RESTRICTION_SOURCES)[number];

/**
 * Auto-restrict (spec: Enforcement ladder, step 2). A restricted account can't
 * start new conversations and its pending Message Requests are hidden until a
 * moderator lifts it. Lifting keeps the row for history.
 */
export const messagingRestrictionsTable = pgTable(
  "messaging_restrictions",
  {
    id: serial("id").primaryKey(),
    clerkUserId: text("clerk_user_id").notNull(),
    reason: text("reason").notNull(),
    source: text("source").notNull(),
    reportId: integer("report_id"),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    liftedAt: timestamp("lifted_at", { withTimezone: true }),
    liftedBy: text("lifted_by"),
  },
  (table) => [index("idx_messaging_restrictions_user").on(table.clerkUserId, table.liftedAt)],
);

export type UserBlock = typeof userBlocksTable.$inferSelect;
export type ContentReport = typeof contentReportsTable.$inferSelect;
export type ReportSource = (typeof REPORT_SOURCES)[number];
export type MessagingRestriction = typeof messagingRestrictionsTable.$inferSelect;

export const AGENT_ACTIONS = ["hide", "restrict", "dismiss", "escalate"] as const;
export type AgentAction = (typeof AGENT_ACTIONS)[number];

/**
 * The Claude moderation agent's decisions (spec: Enforcement ladder step 3).
 * It reviews reports nobody has acted on after 6 hours. John confirms or
 * undoes every decision; undo reverses the action.
 */
export const moderationAgentDecisionsTable = pgTable(
  "moderation_agent_decisions",
  {
    id: serial("id").primaryKey(),
    reportId: integer("report_id")
      .notNull()
      .references(() => contentReportsTable.id, { onDelete: "cascade" }),
    action: text("action").notNull(),
    /** The agent's logged reason, in plain words. */
    reason: text("reason").notNull(),
    /** Hidden message, or restricted account, so undo knows what to reverse. */
    messageId: text("message_id"),
    subjectClerkUserId: text("subject_clerk_user_id"),
    restrictionId: integer("restriction_id"),
    /** The report's status before the agent acted, restored on undo. */
    previousStatus: text("previous_status").notNull(),
    model: text("model").notNull(),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    confirmedAt: timestamp("confirmed_at", { withTimezone: true }),
    undoneAt: timestamp("undone_at", { withTimezone: true }),
    reviewedBy: text("reviewed_by"),
  },
  (table) => [
    uniqueIndex("uq_moderation_agent_decisions_report").on(table.reportId),
    index("idx_moderation_agent_decisions_pending").on(table.confirmedAt, table.undoneAt),
  ],
);

export type ModerationAgentDecision = typeof moderationAgentDecisionsTable.$inferSelect;
