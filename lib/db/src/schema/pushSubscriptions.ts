import { pgTable, serial, text, timestamp } from "drizzle-orm/pg-core";

export const pushSubscriptionsTable = pgTable("push_subscriptions", {
  id: serial("id").primaryKey(),
  userId: text("user_id").notNull(),
  endpoint: text("endpoint").notNull(),
  auth: text("auth"),
  p256dh: text("p256dh"),
  userAgent: text("user_agent"),
  createdAt: timestamp("created_at").defaultNow().notNull(),
  lastUsed: timestamp("last_used"),
  status: text("status").default("active").notNull(),
});
