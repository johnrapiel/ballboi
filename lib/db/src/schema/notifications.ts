import { boolean, pgTable, text, timestamp } from "drizzle-orm/pg-core";

// Settings › Notifications (Wave 2, Session G). One row per account, made the
// first time a switch changes; no row means every default.
// - messagePreviews (decision 128): message pushes show the sender and the
//   text. Off, they read "New message from [name]". iOS's own Show Previews
//   setting still applies on top.

export const notificationSettingsTable = pgTable("notification_settings", {
  clerkUserId: text("clerk_user_id").primaryKey(),
  messagePreviews: boolean("message_previews").notNull().default(true),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
});

export type NotificationSettingsRow = typeof notificationSettingsTable.$inferSelect;
