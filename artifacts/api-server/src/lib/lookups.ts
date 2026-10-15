import { db, playersTable, leaguesTable, leagueRoundsTable } from "@workspace/db";
import { inArray } from "drizzle-orm";

// Targeted lookups for decorating rows with display names. Each one fetches
// only the ids it is given instead of loading the whole table.

function uniqueIds(ids: Array<number | null | undefined>): number[] {
  return [...new Set(ids.filter((id): id is number => id != null))];
}

export async function getPlayerNameMap(ids: Array<number | null | undefined>): Promise<Record<number, string>> {
  const wanted = uniqueIds(ids);
  const map: Record<number, string> = {};
  if (wanted.length === 0) return map;
  const rows = await db
    .select({ id: playersTable.id, name: playersTable.name })
    .from(playersTable)
    .where(inArray(playersTable.id, wanted));
  for (const r of rows) map[r.id] = r.name;
  return map;
}

export async function getLeagueNameMap(ids: Array<number | null | undefined>): Promise<Record<number, string>> {
  const wanted = uniqueIds(ids);
  const map: Record<number, string> = {};
  if (wanted.length === 0) return map;
  const rows = await db
    .select({ id: leaguesTable.id, name: leaguesTable.name })
    .from(leaguesTable)
    .where(inArray(leaguesTable.id, wanted));
  for (const r of rows) map[r.id] = r.name;
  return map;
}

export async function getRoundMap(
  ids: Array<number | null | undefined>,
): Promise<Record<number, { roundNumber: number; endDate: string }>> {
  const wanted = uniqueIds(ids);
  const map: Record<number, { roundNumber: number; endDate: string }> = {};
  if (wanted.length === 0) return map;
  const rows = await db
    .select({ id: leagueRoundsTable.id, roundNumber: leagueRoundsTable.roundNumber, endDate: leagueRoundsTable.endDate })
    .from(leagueRoundsTable)
    .where(inArray(leagueRoundsTable.id, wanted));
  for (const r of rows) map[r.id] = { roundNumber: r.roundNumber, endDate: r.endDate };
  return map;
}

export function matchPlayerIds(m: {
  player1Id: number;
  player2Id: number;
  player3Id?: number | null;
  player4Id?: number | null;
  winnerId?: number | null;
}): Array<number | null | undefined> {
  return [m.player1Id, m.player2Id, m.player3Id, m.player4Id, m.winnerId];
}
