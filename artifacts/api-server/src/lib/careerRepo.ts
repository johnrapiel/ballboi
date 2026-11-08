// Database reads for Career (decision 147). The rules live in career.ts; this
// file only fetches, behind an interface so the route tests without a database.

import { db, leaguesTable, matchesTable, playersTable, seasonsTable, usersTable } from "@workspace/db";
import { and, eq, inArray, isNotNull, isNull, or } from "drizzle-orm";
import { blockedAccountsFor } from "./blocks.js";
import type { CareerInput } from "./career.js";

export type CareerData = Omit<CareerInput, "account" | "blocked">;

export interface CareerRepo {
  /** Every scored match the account played, with the names, leagues and seasons around them. */
  data(clerkUserId: string): Promise<CareerData>;
  /** Accounts blocked with this one, either way. */
  blocked(clerkUserId: string): Promise<Set<string>>;
}

export class DrizzleCareerRepo implements CareerRepo {
  async blocked(clerkUserId: string) {
    return blockedAccountsFor(clerkUserId);
  }

  async data(clerkUserId: string): Promise<CareerData> {
    const mine = await db.select({ id: playersTable.id }).from(playersTable).where(eq(playersTable.clerkUserId, clerkUserId));
    const ids = mine.map((p) => p.id);
    const seasons = await db
      .select({ name: seasonsTable.name, startDate: seasonsTable.startDate, endDate: seasonsTable.endDate })
      .from(seasonsTable)
      .where(isNull(seasonsTable.leagueId));
    if (!ids.length) return { matches: [], players: new Map(), users: new Map(), leagues: new Map(), seasons };
    const matches = await db
      .select({
        id: matchesTable.id,
        leagueId: matchesTable.leagueId,
        player1Id: matchesTable.player1Id,
        player2Id: matchesTable.player2Id,
        player3Id: matchesTable.player3Id,
        player4Id: matchesTable.player4Id,
        winnerId: matchesTable.winnerId,
        status: matchesTable.status,
        score: matchesTable.score,
        completedAt: matchesTable.completedAt,
        voidedAt: matchesTable.voidedAt,
        generatedFrom: matchesTable.generatedFrom,
        playoffBracketId: matchesTable.playoffBracketId,
      })
      .from(matchesTable)
      .where(
        and(
          eq(matchesTable.status, "completed"),
          isNotNull(matchesTable.score),
          isNull(matchesTable.voidedAt),
          or(
            inArray(matchesTable.player1Id, ids),
            inArray(matchesTable.player2Id, ids),
            inArray(matchesTable.player3Id, ids),
            inArray(matchesTable.player4Id, ids),
          ),
        ),
      );
    const playerIds = [...new Set(matches.flatMap((m) => [m.player1Id, m.player2Id, m.player3Id, m.player4Id]).filter((id): id is number => id != null))];
    const leagueIds = [...new Set(matches.map((m) => m.leagueId).filter((id): id is number => id != null))];
    const [players, leagues] = await Promise.all([
      playerIds.length
        ? db.select({ id: playersTable.id, name: playersTable.name, clerkUserId: playersTable.clerkUserId }).from(playersTable).where(inArray(playersTable.id, playerIds))
        : [],
      leagueIds.length ? db.select({ id: leaguesTable.id, name: leaguesTable.name }).from(leaguesTable).where(inArray(leaguesTable.id, leagueIds)) : [],
    ]);
    const accounts = [...new Set(players.map((p) => p.clerkUserId).filter((id): id is string => !!id))];
    const users = accounts.length
      ? await db.select({ id: usersTable.id, clerkUserId: usersTable.clerkUserId, name: usersTable.displayName }).from(usersTable).where(inArray(usersTable.clerkUserId, accounts))
      : [];
    return {
      matches,
      players: new Map(players.map((p) => [p.id, { clerkUserId: p.clerkUserId ?? null, name: p.name }])),
      users: new Map(users.map((u) => [u.clerkUserId, { userId: u.id, name: u.name?.trim() || "Player" }])),
      leagues: new Map(leagues.map((l) => [l.id, { name: l.name }])),
      seasons,
    };
  }
}
