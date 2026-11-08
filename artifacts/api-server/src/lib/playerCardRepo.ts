// Database reads for the player card (decisions 138, 139). The rules live in
// playerCard.ts; this file only fetches, behind an interface so the route
// tests without a database.

import { db, directoryCourtsTable, discoverProfilesTable, matchesTable, matchPlansTable, playersTable, seasonsTable, usersTable } from "@workspace/db";
import { and, eq, inArray, isNotNull, isNull, or } from "drizzle-orm";
import { DrizzleDiscoverRepo } from "./discoverRepo.js";
import { noShowCounts } from "./matchPlan.js";
import type { CardMatch, CardPerson, SeasonWindow } from "./playerCard.js";
import { inWindow } from "./playerCard.js";

export interface PlayerCardRepo {
  /** Your own card's details, or null before your profile exists. */
  me(clerkUserId: string): Promise<(CardPerson & { clerkUserId: string }) | null>;
  /** Global seasons (league_id is null). */
  seasons(): Promise<{ name: string; startDate: string; endDate: string }[]>;
  /** Every scored, unvoided match the account played, and who owns each player row. */
  scored(clerkUserId: string): Promise<{ matches: CardMatch[]; owner: Map<number, string | null> }>;
  /** Confirmed Discover no-shows by the account in the window (F13). */
  noShows(clerkUserId: string, window: SeasonWindow, now: Date): Promise<number>;
}

export class DrizzlePlayerCardRepo implements PlayerCardRepo {
  constructor(private readonly discover = new DrizzleDiscoverRepo()) {}

  async me(clerkUserId: string) {
    // Discover's own read keeps the town in step with your home area.
    const d = await this.discover.me(clerkUserId);
    if (!d) return null;
    const [u] = await db.select().from(usersTable).where(eq(usersTable.clerkUserId, clerkUserId));
    if (!u) return null;
    const [court] = await db
      .select({ name: directoryCourtsTable.name })
      .from(discoverProfilesTable)
      .innerJoin(directoryCourtsTable, eq(directoryCourtsTable.id, discoverProfilesTable.homeCourtId))
      .where(eq(discoverProfilesTable.clerkUserId, clerkUserId));
    return {
      clerkUserId,
      userId: u.id,
      name: u.displayName,
      avatarUrl: u.avatarUrl ?? null,
      rating: u.rating == null ? null : Number(u.rating),
      ratingSource: u.ratingSource ?? null,
      town: d.area?.town || null,
      plays: d.plays,
      homeCourt: court?.name ?? null,
      slots: d.slots,
    };
  }

  async seasons() {
    return db
      .select({ name: seasonsTable.name, startDate: seasonsTable.startDate, endDate: seasonsTable.endDate })
      .from(seasonsTable)
      .where(isNull(seasonsTable.leagueId));
  }

  async scored(clerkUserId: string) {
    const mine = await db.select({ id: playersTable.id }).from(playersTable).where(eq(playersTable.clerkUserId, clerkUserId));
    const ids = mine.map((p) => p.id);
    if (!ids.length) return { matches: [], owner: new Map<number, string | null>() };
    const matches = await db
      .select({
        id: matchesTable.id,
        player1Id: matchesTable.player1Id,
        player2Id: matchesTable.player2Id,
        player3Id: matchesTable.player3Id,
        player4Id: matchesTable.player4Id,
        winnerId: matchesTable.winnerId,
        completedAt: matchesTable.completedAt,
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
    const everyone = [...new Set(matches.flatMap((m) => [m.player1Id, m.player2Id, m.player3Id, m.player4Id]).filter((id): id is number => id != null))];
    const owners = everyone.length
      ? await db.select({ id: playersTable.id, clerkUserId: playersTable.clerkUserId }).from(playersTable).where(inArray(playersTable.id, everyone))
      : [];
    return { matches, owner: new Map(owners.map((o) => [o.id, o.clerkUserId ?? null])) };
  }

  async noShows(clerkUserId: string, window: SeasonWindow, now: Date) {
    const rows = await db
      .select({ plan: matchPlansTable, matchId: matchesTable.id, score: matchesTable.score })
      .from(matchPlansTable)
      .leftJoin(matchesTable, eq(matchesTable.id, matchPlansTable.matchId))
      .where(and(eq(matchPlansTable.noShowClerkUserId, clerkUserId), isNotNull(matchPlansTable.noShowStatus)));
    const inSeason = rows.filter((r) => inWindow(r.plan.startsAt, window));
    return noShowCounts(inSeason.map((r) => ({ plan: r.plan, match: { matchId: r.matchId, score: r.score } })), now).get(clerkUserId) ?? 0;
  }
}
