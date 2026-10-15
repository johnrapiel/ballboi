import { pgTable, serial, integer, text, timestamp, uniqueIndex } from "drizzle-orm/pg-core";
import { matchesTable } from "./matches";

export const matchRemindersLogTable = pgTable(
  "match_reminders_log",
  {
    id: serial("id").primaryKey(),
    matchId: integer("match_id").notNull().references(() => matchesTable.id, { onDelete: "cascade" }),
    reminderType: text("reminder_type").notNull(),
    reminderForDate: text("reminder_for_date").notNull(),
    sentAt: timestamp("sent_at", { withTimezone: true }).notNull().defaultNow(),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    uniqueIndex("match_reminders_log_match_type_date_unique").on(
      table.matchId,
      table.reminderType,
      table.reminderForDate
    ),
  ]
);

export type MatchReminderLog = typeof matchRemindersLogTable.$inferSelect;
export type InsertMatchReminderLog = typeof matchRemindersLogTable.$inferInsert;