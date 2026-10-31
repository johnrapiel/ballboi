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
/** user: a person reported it. auto: auto-restrict fired. stream: Stream moderation flagged it. appeal: a banned or suspended person appealed. */
export const REPORT_SOURCES = ["user", "auto", "stream", "appeal"] as const;

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

export const SANCTION_KINDS = ["ban", "suspend"] as const;
export type SanctionKind = (typeof SANCTION_KINDS)[number];

/**
 * Bans and suspensions (spec: Enforcement ladder steps 4 to 6). Human-only:
 * a moderator creates them, never the agent or auto-restrict. Enforced at
 * sign-in against the Clerk account, the Sign in with Apple user ID and the
 * email address, so deleting the account and signing up again doesn't get
 * around a ban. Kept after account deletion for that reason.
 * DeviceCheck device bans come in Wave 2.
 */
export const accountSanctionsTable = pgTable(
  "account_sanctions",
  {
    id: serial("id").primaryKey(),
    kind: text("kind").notNull(),
    clerkUserId: text("clerk_user_id").notNull(),
    /** The Sign in with Apple user ID ("sub"), when the account used Apple. */
    appleUserId: text("apple_user_id"),
    /** Lowercased email addresses on the account when it was sanctioned. */
    emails: jsonb("emails").$type<string[]>().notNull().default([]),
    /** For moderators only; the person sees a plain, general message. */
    reason: text("reason").notNull(),
    reportId: integer("report_id"),
    /** Suspensions end here. Null for bans. */
    endsAt: timestamp("ends_at", { withTimezone: true }),
    createdBy: text("created_by").notNull(),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    liftedAt: timestamp("lifted_at", { withTimezone: true }),
    liftedBy: text("lifted_by"),
  },
  (table) => [
    index("idx_account_sanctions_user").on(table.clerkUserId, table.liftedAt),
    index("idx_account_sanctions_apple").on(table.appleUserId),
  ],
);

export const APPEAL_OUTCOMES = ["upheld", "overturned"] as const;
export type AppealOutcome = (typeof APPEAL_OUTCOMES)[number];

/** One appeal per sanction (spec: "One appeal: by email"), logged in the reports queue. */
export const sanctionAppealsTable = pgTable(
  "sanction_appeals",
  {
    id: serial("id").primaryKey(),
    sanctionId: integer("sanction_id")
      .notNull()
      .references(() => accountSanctionsTable.id, { onDelete: "cascade" }),
    clerkUserId: text("clerk_user_id").notNull(),
    /** The report row that puts the appeal in /api/admin/reports. */
    reportId: integer("report_id"),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    outcome: text("outcome"),
    note: text("note"),
    decidedAt: timestamp("decided_at", { withTimezone: true }),
    decidedBy: text("decided_by"),
  },
  (table) => [uniqueIndex("uq_sanction_appeals_sanction").on(table.sanctionId)],
);

export type AccountSanction = typeof accountSanctionsTable.$inferSelect;
export type SanctionAppeal = typeof sanctionAppealsTable.$inferSelect;
