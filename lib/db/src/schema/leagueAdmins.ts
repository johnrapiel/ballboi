import { pgTable, text, serial, timestamp, integer, index, uniqueIndex } from "drizzle-orm/pg-core";
import { leaguesTable } from "./leagues";

// Admin is a role on a specific league (spec: Roles and onboarding). The
// creator is the owner; any admin can promote a member to co-admin.
// Migration 20261029_c_league_rules.sql.

export const LEAGUE_ADMIN_ROLES = ["owner", "co_admin"] as const;
export type LeagueAdminRole = (typeof LEAGUE_ADMIN_ROLES)[number];

export const leagueAdminsTable = pgTable(
  "league_admins",
  {
    id: serial("id").primaryKey(),
    leagueId: integer("league_id").notNull().references(() => leaguesTable.id, { onDelete: "cascade" }),
    clerkUserId: text("clerk_user_id").notNull(),
    role: text("role").$type<LeagueAdminRole>().notNull().default("co_admin"),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    uniqueIndex("uq_league_admins_member").on(table.leagueId, table.clerkUserId),
    index("idx_league_admins_clerk_user_id").on(table.clerkUserId),
  ],
);

export type LeagueAdmin = typeof leagueAdminsTable.$inferSelect;
