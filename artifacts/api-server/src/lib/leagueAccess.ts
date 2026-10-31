// Database lookups for league roles. Rules live in leagueRoles.ts.

import { db, leagueAdminsTable, leaguesTable } from "@workspace/db";
import { and, eq } from "drizzle-orm";
import type { LeagueRole } from "./leagueRoles.js";

/** The user's admin role in a league, or null. Falls back to the creator for leagues made before co-admins. */
export async function getLeagueRole(leagueId: number, clerkUserId: string): Promise<LeagueRole | null> {
  const [row] = await db
    .select({ role: leagueAdminsTable.role })
    .from(leagueAdminsTable)
    .where(and(eq(leagueAdminsTable.leagueId, leagueId), eq(leagueAdminsTable.clerkUserId, clerkUserId)));
  if (row) return row.role;
  const [league] = await db
    .select({ createdBy: leaguesTable.createdByClerkUserId })
    .from(leaguesTable)
    .where(eq(leaguesTable.id, leagueId));
  return league?.createdBy === clerkUserId ? "owner" : null;
}

export async function isLeagueAdmin(leagueId: number, clerkUserId: string): Promise<boolean> {
  return (await getLeagueRole(leagueId, clerkUserId)) !== null;
}
