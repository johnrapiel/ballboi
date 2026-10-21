import { pgTable, text, serial, timestamp, index, uniqueIndex } from "drizzle-orm/pg-core";

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

export const REPORT_TARGET_TYPES = ["player", "league", "ball_boi_session", "match"] as const;
export const REPORT_REASONS = ["harassment", "inappropriate_content", "impersonation", "spam", "cheating", "other"] as const;
export const REPORT_STATUSES = ["open", "reviewed", "actioned", "dismissed"] as const;

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
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    reviewedAt: timestamp("reviewed_at", { withTimezone: true }),
  },
  (table) => [index("idx_content_reports_status").on(table.status, table.createdAt)],
);

export type UserBlock = typeof userBlocksTable.$inferSelect;
export type ContentReport = typeof contentReportsTable.$inferSelect;
