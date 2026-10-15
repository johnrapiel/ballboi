import { pgTable, serial, text, timestamp } from "drizzle-orm/pg-core";

export const expoPushTokensTable = pgTable("expo_push_tokens", {
  id: serial("id").primaryKey(),
  userId: text("user_id").notNull(),
  token: text("token").notNull().unique(),
  createdAt: timestamp("created_at").defaultNow().notNull(),
  lastUsed: timestamp("last_used"),
  status: text("status").default("active").notNull(),
});
