// Draft rounds stay with the league's admins (decision 29). A round's pairings
// reach players only once it goes out (publishedAt set), by the 7am job or an
// admin's Send. Until then its matches are hidden from every route that shows
// rounds or matches to players.

import { db, leagueRoundsTable } from "@workspace/db";
import { inArray } from "drizzle-orm";

/** True for a round that hasn't gone out to players yet. */
export function isDraftRound(round: { publishedAt: Date | null }): boolean {
  return round.publishedAt == null;
}

/** The rounds someone may see: every round in leagues they run, only rounds that went out elsewhere. */
export function visibleRounds<T extends { publishedAt: Date | null }>(rounds: T[], isLeagueAdmin: boolean): T[] {
  return isLeagueAdmin ? rounds : rounds.filter((r) => !isDraftRound(r));
}

/** Leagues the person runs, or a lookup for them, made only when a draft turns up. */
export type AdminLeagues = number[] | (() => Promise<number[]>);

/**
 * Ids among `roundIds` that are drafts in leagues outside `adminLeagues`:
 * their matches must not be shown to this person.
 */
export async function hiddenDraftRoundIds(roundIds: (number | null | undefined)[], adminLeagues: AdminLeagues): Promise<Set<number>> {
  const ids = [...new Set(roundIds.filter((id): id is number => id != null))];
  if (!ids.length) return new Set();
  const rounds = await db
    .select({ id: leagueRoundsTable.id, leagueId: leagueRoundsTable.leagueId, publishedAt: leagueRoundsTable.publishedAt })
    .from(leagueRoundsTable)
    .where(inArray(leagueRoundsTable.id, ids));
  const drafts = rounds.filter(isDraftRound);
  if (!drafts.length) return new Set();
  const runs = typeof adminLeagues === "function" ? await adminLeagues() : adminLeagues;
  return new Set(drafts.filter((r) => !runs.includes(r.leagueId)).map((r) => r.id));
}

/** Drops matches that belong to a draft round in a league this person doesn't run. */
export async function withoutDraftMatches<T extends { roundId: number | null }>(matches: T[], adminLeagueIds: AdminLeagues): Promise<T[]> {
  const hidden = await hiddenDraftRoundIds(matches.map((m) => m.roundId), adminLeagueIds);
  return hidden.size ? matches.filter((m) => m.roundId == null || !hidden.has(m.roundId)) : matches;
}
