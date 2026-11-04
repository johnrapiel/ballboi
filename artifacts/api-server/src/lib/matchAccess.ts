// What league, match and player data a signed-in person may read (Wave 1
// review). Matches: ones they played in, or in leagues they can see. Players:
// their own records, or players in leagues they can see. Contact details
// (email, phone) only to the player themselves and that league's admins.

import { db, leaguesTable, matchesTable, playersTable } from "@workspace/db";
import { eq, inArray, or, type SQL } from "drizzle-orm";
import { adminLeagueIds, memberLeagueIds } from "./leagueAccess.js";

export interface ReadScope {
  /** Leagues whose matches and players they can see. */
  leagueIds: number[];
  /** Leagues they run. */
  adminLeagueIds: number[];
  /** Their own player records, in any league or quick match. */
  myPlayerIds: number[];
  /** A where-clause for matchesTable limited to what they can see. */
  matchFilter: SQL;
}

/**
 * `openLeagues` adds every Open league (visible to anyone signed in). Stats
 * leave it off and count only leagues the person belongs to.
 */
export async function readScope(clerkUserId: string, opts: { openLeagues: boolean }): Promise<ReadScope> {
  const [member, admin, mine, open] = await Promise.all([
    memberLeagueIds(clerkUserId),
    adminLeagueIds(clerkUserId),
    db.select({ id: playersTable.id }).from(playersTable).where(eq(playersTable.clerkUserId, clerkUserId)),
    opts.openLeagues
      ? db.select({ id: leaguesTable.id }).from(leaguesTable).where(eq(leaguesTable.visibility, "open"))
      : Promise.resolve([] as { id: number }[]),
  ]);
  const leagueIds = [...new Set([...member, ...admin, ...open.map((l) => l.id)])];
  const myPlayerIds = mine.map((p) => p.id);
  // inArray needs at least one id; -1 matches nothing.
  const leagues = leagueIds.length ? leagueIds : [-1];
  const players = myPlayerIds.length ? myPlayerIds : [-1];
  const matchFilter = or(
    inArray(matchesTable.leagueId, leagues),
    inArray(matchesTable.player1Id, players),
    inArray(matchesTable.player2Id, players),
    inArray(matchesTable.player3Id, players),
    inArray(matchesTable.player4Id, players),
  )!;
  return { leagueIds, adminLeagueIds: admin, myPlayerIds, matchFilter };
}

type MatchPlayers = { leagueId: number | null; player1Id: number; player2Id: number; player3Id: number | null; player4Id: number | null };

export function canSeeMatch(scope: ReadScope, m: MatchPlayers): boolean {
  if (m.leagueId != null && scope.leagueIds.includes(m.leagueId)) return true;
  return [m.player1Id, m.player2Id, m.player3Id, m.player4Id].some((id) => id != null && scope.myPlayerIds.includes(id));
}

export function canSeePlayer(scope: ReadScope, p: { id: number; leagueId: number | null }): boolean {
  return scope.myPlayerIds.includes(p.id) || (p.leagueId != null && scope.leagueIds.includes(p.leagueId));
}

/** Email and phone are for the player themselves and their league's admins. */
export function canSeeContact(scope: ReadScope, p: { id: number; leagueId: number | null }): boolean {
  return scope.myPlayerIds.includes(p.id) || (p.leagueId != null && scope.adminLeagueIds.includes(p.leagueId));
}
