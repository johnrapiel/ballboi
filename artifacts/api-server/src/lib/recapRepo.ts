// Database reads for the match recap (decision 148). The rules live in recap.ts.

import { db, leaguesTable, matchesTable, matchPlansTable, playersTable, usersTable } from "@workspace/db";
import { eq, inArray } from "drizzle-orm";
import { seasonStats, seasonWindow } from "./playerCard.js";
import { DrizzlePlayerCardRepo } from "./playerCardRepo.js";
import type { RecapInput } from "./recap.js";

export interface RecapRepo {
  /** The match and what's around it, or null when it doesn't exist. */
  load(matchId: number): Promise<Omit<RecapInput, "viewer" | "season"> | null>;
  /** The account's record for the season a day (YYYY-MM-DD) falls in, after every match that day and before. */
  season(clerkUserId: string, day: string, matchAt: string | null): Promise<{ name: string; wins: number; losses: number } | null>;
}

export class DrizzleRecapRepo implements RecapRepo {
  constructor(private readonly cards = new DrizzlePlayerCardRepo()) {}

  async load(matchId: number) {
    const [m] = await db.select().from(matchesTable).where(eq(matchesTable.id, matchId));
    if (!m) return null;
    const ids = [m.player1Id, m.player2Id, m.player3Id, m.player4Id].filter((id): id is number => id != null);
    const [players, league, plan] = await Promise.all([
      db
        .select({ id: playersTable.id, name: playersTable.name, clerkUserId: playersTable.clerkUserId, displayName: usersTable.displayName })
        .from(playersTable)
        .leftJoin(usersTable, eq(usersTable.clerkUserId, playersTable.clerkUserId))
        .where(inArray(playersTable.id, ids)),
      m.leagueId != null ? db.select({ name: leaguesTable.name }).from(leaguesTable).where(eq(leaguesTable.id, m.leagueId)) : Promise.resolve([]),
      db.select({ courtName: matchPlansTable.courtName }).from(matchPlansTable).where(eq(matchPlansTable.matchId, matchId)),
    ]);
    return {
      match: m,
      players: new Map(players.map((p) => [p.id, { name: (p.clerkUserId ? p.displayName?.trim() : null) || p.name, clerkUserId: p.clerkUserId ?? null }])),
      leagueName: league[0]?.name ?? null,
      planCourt: plan[0]?.courtName ?? null,
    };
  }

  async season(clerkUserId: string, day: string, matchAt: string | null) {
    const window = seasonWindow(await this.cards.seasons(), day);
    const { matches, owner } = await this.cards.scored(clerkUserId);
    // Only matches up to this one, so an older recap shows the record as it was then.
    const upTo = matchAt ? matches.filter((x) => (x.completedAt ?? "") <= matchAt) : matches;
    const s = seasonStats(clerkUserId, upTo, (id) => owner.get(id) ?? null, window, 0);
    return { name: window.name, wins: s.wins, losses: s.losses };
  }
}
