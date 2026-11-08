// Database reads for the player card (decisions 138, 139). The rules live in
// playerCard.ts; this file only fetches, behind an interface so the route
// tests without a database.

import {
  db,
  directoryCourtsTable,
  discoverProfilesTable,
  leagueAdminsTable,
  leagueRoundsTable,
  leaguesTable,
  matchesTable,
  matchPlansTable,
  playersTable,
  seasonsTable,
  usersTable,
} from "@workspace/db";
import { and, eq, gte, inArray, isNotNull, isNull, or } from "drizzle-orm";
import { blockedAccountsFor } from "./blocks.js";
import { distanceLabel, milesBetween } from "./discoverArea.js";
import { DrizzleDiscoverRepo } from "./discoverRepo.js";
import { noShowCounts } from "./matchPlan.js";
import type { CardMatch, CardPerson, SeasonWindow } from "./playerCard.js";
import { inWindow } from "./playerCard.js";
import type { PMInput } from "./playerMatches.js";

/** Everything playerMatches needs, apart from who and when. */
export type MatchData = Omit<PMInput, "target" | "viewer" | "now" | "blocked">;

export interface PlayerCardRepo {
  /** Your own card's details, or null before your profile exists. */
  me(clerkUserId: string): Promise<(CardPerson & { clerkUserId: string }) | null>;
  /** Global seasons (league_id is null). */
  seasons(): Promise<{ name: string; startDate: string; endDate: string }[]>;
  /** Every scored, unvoided match the account played, and who owns each player row. */
  scored(clerkUserId: string): Promise<{ matches: CardMatch[]; owner: Map<number, string | null> }>;
  /** Confirmed Discover no-shows by the account in the window (F13). */
  noShows(clerkUserId: string, window: SeasonWindow, now: Date): Promise<number>;
  /**
   * Another player as the viewer may see them: null when they're not in
   * Discover (hidden, banned, never set up). `distance` is from the viewer's area.
   */
  other(viewer: string, userId: number): Promise<{ person: CardPerson & { clerkUserId: string }; hidden: boolean; distance: string | null } | null>;
  /** Accounts blocked with this one, either way. */
  blocked(clerkUserId: string): Promise<Set<string>>;
  /** The target's matches and plans, with the names, leagues and rounds around them. */
  matchData(target: string, viewer: string, now: Date): Promise<MatchData>;
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

  async other(viewer: string, userId: number) {
    // Discover's read leaves out hidden, banned and blocked players.
    const p = await this.discover.person(viewer, userId);
    if (!p) return null;
    const me = await this.discover.me(viewer);
    const miles = me?.area ? milesBetween(me.area.point, p.point) : null;
    return {
      person: {
        clerkUserId: p.clerkUserId,
        userId: p.userId,
        name: p.name,
        avatarUrl: p.avatarUrl,
        rating: p.rating,
        ratingSource: p.ratingSource,
        town: p.town,
        plays: p.plays,
        homeCourt: p.homeCourt ?? null,
        slots: p.slots,
      },
      hidden: false,
      distance: miles == null ? null : `${distanceLabel(miles)} away`,
    };
  }

  async blocked(clerkUserId: string) {
    return blockedAccountsFor(clerkUserId);
  }

  async matchData(target: string, viewer: string, now: Date): Promise<MatchData> {
    const [theirRows, viewerRows, viewerAdmin] = await Promise.all([
      db.select({ id: playersTable.id }).from(playersTable).where(eq(playersTable.clerkUserId, target)),
      db.select({ leagueId: playersTable.leagueId }).from(playersTable).where(eq(playersTable.clerkUserId, viewer)),
      db.select({ leagueId: leagueAdminsTable.leagueId }).from(leagueAdminsTable).where(eq(leagueAdminsTable.clerkUserId, viewer)),
    ]);
    const ids = theirRows.map((p) => p.id);
    const matches = ids.length
      ? await db
          .select()
          .from(matchesTable)
          .where(
            or(
              inArray(matchesTable.player1Id, ids),
              inArray(matchesTable.player2Id, ids),
              inArray(matchesTable.player3Id, ids),
              inArray(matchesTable.player4Id, ids),
            ),
          )
      : [];
    const playerIds = [...new Set(matches.flatMap((m) => [m.player1Id, m.player2Id, m.player3Id, m.player4Id]).filter((id): id is number => id != null))];
    const leagueIds = [...new Set(matches.map((m) => m.leagueId).filter((id): id is number => id != null))];
    const roundIds = [...new Set(matches.map((m) => m.roundId).filter((id): id is number => id != null))];
    const since = new Date(now.getTime() - 3 * 3_600_000);
    const [players, leagues, rounds, plans] = await Promise.all([
      playerIds.length
        ? db
            .select({ id: playersTable.id, name: playersTable.name, clerkUserId: playersTable.clerkUserId, displayName: usersTable.displayName })
            .from(playersTable)
            .leftJoin(usersTable, eq(usersTable.clerkUserId, playersTable.clerkUserId))
            .where(inArray(playersTable.id, playerIds))
        : [],
      leagueIds.length ? db.select().from(leaguesTable).where(inArray(leaguesTable.id, leagueIds)) : [],
      roundIds.length ? db.select().from(leagueRoundsTable).where(inArray(leagueRoundsTable.id, roundIds)) : [],
      db
        .select({ plan: matchPlansTable, score: matchesTable.score })
        .from(matchPlansTable)
        .leftJoin(matchesTable, eq(matchesTable.id, matchPlansTable.matchId))
        .where(
          and(
            eq(matchPlansTable.status, "accepted"),
            or(eq(matchPlansTable.proposerClerkUserId, target), eq(matchPlansTable.recipientClerkUserId, target)),
            gte(matchPlansTable.startsAt, since),
          ),
        ),
    ]);
    const others = [...new Set([...players.map((p) => p.clerkUserId), ...plans.map((r) => (r.plan.proposerClerkUserId === target ? r.plan.recipientClerkUserId : r.plan.proposerClerkUserId))].filter((id): id is string => !!id))];
    const users = others.length
      ? await db.select({ id: usersTable.id, clerkUserId: usersTable.clerkUserId, name: usersTable.displayName }).from(usersTable).where(inArray(usersTable.clerkUserId, others))
      : [];
    const userIds = new Map(users.map((u) => [u.clerkUserId, u.id]));
    const userNames = new Map(users.map((u) => [u.clerkUserId, u.name]));
    return {
      matches,
      players: new Map(players.map((p) => [p.id, { id: p.id, name: p.displayName?.trim() || p.name, clerkUserId: p.clerkUserId ?? null }])),
      leagues: new Map(leagues.map((l) => [l.id, { id: l.id, name: l.name, visibility: l.visibility, endedAt: l.endedAt ?? null, timeZone: l.timeZone }])),
      rounds: new Map(rounds.map((r) => [r.id, { id: r.id, publishedAt: r.publishedAt ?? null, startDate: r.startDate, endDate: r.endDate }])),
      plans: plans.map((r) => {
        const other = r.plan.proposerClerkUserId === target ? r.plan.recipientClerkUserId : r.plan.proposerClerkUserId;
        return { id: r.plan.id, startsAt: r.plan.startsAt, otherClerkUserId: other, otherName: userNames.get(other) ?? "Player", score: r.score ?? null };
      }),
      viewerLeagueIds: new Set([...viewerRows.map((r) => r.leagueId), ...viewerAdmin.map((r) => r.leagueId)].filter((id): id is number => id != null)),
      userIds,
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
