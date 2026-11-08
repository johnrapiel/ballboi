// Database reads and writes for Match detail (decision 151). The rules live
// in matchDetail.ts and matchScoreEdit.ts.

import {
  ballBoiSessionsTable,
  db,
  leagueRoundsTable,
  leaguesTable,
  matchesTable,
  matchPlansTable,
  matchShotsTable,
  playersTable,
  usersTable,
  type Match,
} from "@workspace/db";
import { and, count, desc, eq, inArray, isNull } from "drizzle-orm";
import { blockedAccountsFor } from "./blocks.js";
import type { DetailInput, DetailPlayer } from "./matchDetail.js";

export interface MatchDetailData {
  match: Match;
  /** Names as shown: a signed-up player's profile name, a placeholder's own. */
  players: DetailPlayer[];
  league: DetailInput["league"];
  roundNumber: number | null;
  plan: DetailInput["plan"];
  replay: DetailInput["replay"];
}

export interface MatchDetailRepo {
  /** The match and what's around it, or null when it doesn't exist. */
  load(matchId: number): Promise<MatchDetailData | null>;
  /** Accounts blocked with this one, either way. */
  blocked(clerkUserId: string): Promise<Set<string>>;
  /**
   * Saves an edit to a Discover or Quick match's score, only if the score is
   * still `previous`, so two edits at once can't both land. Touches only the
   * match row: there are no standings or league records outside a league.
   */
  saveEdit(
    matchId: number,
    previous: string,
    edit: { score: string; winnerId: number; byClerkUserId: string; byName: string; at: Date },
  ): Promise<Match | null>;
}

export class DrizzleMatchDetailRepo implements MatchDetailRepo {
  async load(matchId: number): Promise<MatchDetailData | null> {
    const [match] = await db.select().from(matchesTable).where(eq(matchesTable.id, matchId));
    if (!match) return null;
    const ids = [match.player1Id, match.player2Id, match.player3Id, match.player4Id].filter((id): id is number => id != null);
    const [players, league, round, plan, session] = await Promise.all([
      db
        .select({ id: playersTable.id, name: playersTable.name, clerkUserId: playersTable.clerkUserId, displayName: usersTable.displayName })
        .from(playersTable)
        .leftJoin(usersTable, eq(usersTable.clerkUserId, playersTable.clerkUserId))
        .where(inArray(playersTable.id, ids)),
      match.leagueId != null ? db.select().from(leaguesTable).where(eq(leaguesTable.id, match.leagueId)) : Promise.resolve([]),
      match.roundId
        ? db.select({ roundNumber: leagueRoundsTable.roundNumber }).from(leagueRoundsTable).where(eq(leagueRoundsTable.id, match.roundId))
        : Promise.resolve([]),
      match.leagueId == null
        ? db
            .select({ courtName: matchPlansTable.courtName, timeZone: matchPlansTable.timeZone })
            .from(matchPlansTable)
            .where(eq(matchPlansTable.matchId, matchId))
        : Promise.resolve([]),
      // The Ball Boi Replay row shows only once an analysis has finished.
      db
        .select({ id: ballBoiSessionsTable.id, durationSeconds: ballBoiSessionsTable.durationSeconds })
        .from(ballBoiSessionsTable)
        .where(and(eq(ballBoiSessionsTable.matchId, matchId), eq(ballBoiSessionsTable.status, "completed")))
        .orderBy(desc(ballBoiSessionsTable.createdAt))
        .limit(1),
    ]);
    // A league match whose league is gone has nothing to show.
    if (match.leagueId != null && !league[0]) return null;
    const s = session[0];
    const shots = s ? (await db.select({ n: count() }).from(matchShotsTable).where(eq(matchShotsTable.sessionId, s.id)))[0]?.n ?? 0 : 0;
    return {
      match,
      // A1: a signed-up player's profile name; a placeholder's name from the row.
      players: players.map((p) => ({ id: p.id, name: (p.clerkUserId ? p.displayName?.trim() : null) || p.name, clerkUserId: p.clerkUserId })),
      league: league[0] ?? null,
      roundNumber: round[0]?.roundNumber ?? null,
      plan: plan[0] ?? null,
      replay: s ? { durationSeconds: s.durationSeconds ?? null, shotCount: Number(shots) } : null,
    };
  }

  async blocked(clerkUserId: string) {
    return blockedAccountsFor(clerkUserId);
  }

  async saveEdit(matchId: number, previous: string, edit: { score: string; winnerId: number; byClerkUserId: string; byName: string; at: Date }) {
    const [saved] = await db
      .update(matchesTable)
      .set({ score: edit.score, winnerId: edit.winnerId, scoreEditedAt: edit.at, scoreEditedByClerkUserId: edit.byClerkUserId, scoreEditedByName: edit.byName })
      .where(
        and(
          eq(matchesTable.id, matchId),
          isNull(matchesTable.leagueId),
          eq(matchesTable.status, "completed"),
          eq(matchesTable.score, previous),
          isNull(matchesTable.voidedAt),
        ),
      )
      .returning();
    return saved ?? null;
  }
}
