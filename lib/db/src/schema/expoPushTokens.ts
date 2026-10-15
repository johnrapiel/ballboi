import { pgTable, serial, text, timestamp, index } from "drizzle-orm/pg-core";

export const expoPushTokensTable = pgTable("expo_push_tokens", {
  id: serial("id").primaryKey(),
  userId: text("user_id").notNull(),
  token: text("token").notNull().unique(),
  createdAt: timestamp("created_at").defaultNow().notNull(),
  lastUsed: timestamp("last_used"),
  status: text("status").default("active").notNull(),
}, (table) => [
  index("idx_expo_push_tokens_user_id").on(table.userId),
]);
