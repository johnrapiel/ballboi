import { pgTable, text, serial, timestamp, integer, index } from "drizzle-orm/pg-core";
import { matchesTable } from "./matches";

// "Something not working?" (spec decision 86, B3). A tester picks a likely
// problem or "Something else" with a description, adds an optional note, and
// sends it. The app attaches its version, the iPhone and iOS version, and the
// match when it was opened from a match. Saved here and emailed to
// support@ballboi.tennis. Also the in-app support contact on the App Store
// checklist.

export const supportReportsTable = pgTable(
  "support_reports",
  {
    id: serial("id").primaryKey(),
    /** Null once the reporter deletes their account; the report stays for support. */
    clerkUserId: text("clerk_user_id"),
    /** One of FEEDBACK_PROBLEMS in the API (routes/feedback.ts). */
    problem: text("problem").notNull(),
    /** Required for "Something else", optional otherwise. */
    note: text("note"),
    /** Where the form was opened: settings, ready, processing, replay. */
    source: text("source").notNull(),
    matchId: integer("match_id").references(() => matchesTable.id, { onDelete: "set null" }),
    appVersion: text("app_version"),
    deviceModel: text("device_model"),
    osVersion: text("os_version"),
    /** When the email to support went out. Null if it hasn't (no email service set up, or it failed). */
    emailedAt: timestamp("emailed_at", { withTimezone: true }),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [index("support_reports_user_created_idx").on(t.clerkUserId, t.createdAt)],
);

export type SupportReport = typeof supportReportsTable.$inferSelect;
