// Database lookups for league roles. Rules live in leagueRoles.ts.

import { db, leagueAdminsTable, leaguesTable, playersTable } from "@workspace/db";
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

/** How many people run the league. A league with no admin rows is run by its creator. */
export async function leagueAdminCount(leagueId: number): Promise<number> {
  const rows = await db.select({ id: leagueAdminsTable.id }).from(leagueAdminsTable).where(eq(leagueAdminsTable.leagueId, leagueId));
  if (rows.length) return rows.length;
  const [league] = await db.select({ createdBy: leaguesTable.createdByClerkUserId }).from(leaguesTable).where(eq(leaguesTable.id, leagueId));
  return league?.createdBy ? 1 : 0;
}

/**
 * Leagues the user belongs to: ones they started, run as an admin, or have a
 * player record in (past seasons and leagues they left included, so their own
 * history stays visible to them).
 */
export async function memberLeagueIds(clerkUserId: string): Promise<number[]> {
  const [players, admins, created] = await Promise.all([
    db.select({ leagueId: playersTable.leagueId }).from(playersTable).where(eq(playersTable.clerkUserId, clerkUserId)),
    db.select({ leagueId: leagueAdminsTable.leagueId }).from(leagueAdminsTable).where(eq(leagueAdminsTable.clerkUserId, clerkUserId)),
    db.select({ leagueId: leaguesTable.id }).from(leaguesTable).where(eq(leaguesTable.createdByClerkUserId, clerkUserId)),
  ]);
  const ids = [...players, ...admins, ...created]
    .map((r) => r.leagueId)
    .filter((id): id is number => id != null);
  return [...new Set(ids)];
}

/**
 * Who can see a league's details and standings: anyone signed in for an Open
 * league; only its members and admins for a Private one.
 */
export async function canViewLeague(
  league: { id: number; visibility: string | null; createdByClerkUserId: string | null },
  clerkUserId: string,
): Promise<boolean> {
  if (league.visibility === "open") return true;
  if (league.createdByClerkUserId === clerkUserId) return true;
  return (await memberLeagueIds(clerkUserId)).includes(league.id);
}
