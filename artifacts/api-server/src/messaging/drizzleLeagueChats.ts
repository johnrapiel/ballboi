import { db, leagueAdminsTable, leaguesTable, matchesTable, playersTable } from "@workspace/db";
import { and, eq, inArray, isNotNull, isNull } from "drizzle-orm";
import { leagueHasEnded } from "../lib/leagueLifecycle";
import { scoreFromSide } from "../lib/leagueScoring";
import { computeStandings } from "../lib/leagueStandings";
import { getPastSeasonNames } from "../services/seasonService";
import type { LeagueChatMember, LeagueChatSource } from "./leagueChats";

/** LeagueChatSource on Postgres. */
export class DrizzleLeagueChatSource implements LeagueChatSource {
  async league(leagueId: number) {
    const [row] = await db
      .select({ id: leaguesTable.id, name: leaguesTable.name, endedAt: leaguesTable.endedAt, status: leaguesTable.status })
      .from(leaguesTable)
      .where(eq(leaguesTable.id, leagueId));
    return row ? { id: row.id, name: row.name, ended: leagueHasEnded(row) } : null;
  }

  /** Current players with an account, plus admins (the creator, for a league made before co-admins). */
  async members(leagueId: number): Promise<LeagueChatMember[]> {
    const [players, admins, [league]] = await Promise.all([
      db
        .select({ id: playersTable.id, clerkUserId: playersTable.clerkUserId })
        .from(playersTable)
        .where(and(eq(playersTable.leagueId, leagueId), isNull(playersTable.leftAt), isNotNull(playersTable.clerkUserId))),
      db.select({ clerkUserId: leagueAdminsTable.clerkUserId }).from(leagueAdminsTable).where(eq(leagueAdminsTable.leagueId, leagueId)),
      db.select({ createdBy: leaguesTable.createdByClerkUserId }).from(leaguesTable).where(eq(leaguesTable.id, leagueId)),
    ]);
    const adminIds = new Set(admins.map((a) => a.clerkUserId));
    if (!adminIds.size && league?.createdBy) adminIds.add(league.createdBy);
    const out = new Map<string, LeagueChatMember>();
    for (const p of players) out.set(p.clerkUserId!, { userId: p.clerkUserId!, admin: adminIds.has(p.clerkUserId!), playerId: p.id });
    for (const id of adminIds) if (!out.has(id)) out.set(id, { userId: id, admin: true, playerId: null });
    return [...out.values()];
  }

  async allLeagueIds() {
    const rows = await db.select({ id: leaguesTable.id }).from(leaguesTable);
    return rows.map((r) => r.id);
  }

  async result(leagueId: number, matchId: number) {
    const [m] = await db
      .select()
      .from(matchesTable)
      .where(and(eq(matchesTable.id, matchId), eq(matchesTable.leagueId, leagueId)));
    if (!m || m.status !== "completed" || m.winnerId == null || m.voidedAt) return null;
    const team1 = [m.player1Id, m.player3Id].filter((id): id is number => id != null);
    const team2 = [m.player2Id, m.player4Id].filter((id): id is number => id != null);
    const players = await db
      .select({ id: playersTable.id, name: playersTable.name })
      .from(playersTable)
      .where(inArray(playersTable.id, [...team1, ...team2]));
    const name = (id: number) => players.find((p) => p.id === id)?.name ?? "A player";
    const winnerSide: 1 | 2 = m.winnerId === m.player1Id || m.winnerId === m.player3Id ? 1 : 2;
    const [winners, losers] = winnerSide === 1 ? [team1, team2] : [team2, team1];
    return {
      winners: winners.map(name),
      losers: losers.map(name),
      score: m.score ? scoreFromSide(m.score, winnerSide) : null,
      counts: !m.inGrace && !m.playoffBracketId,
    };
  }

  /** The league's standings now, the way the standings route counts them. */
  async standings(leagueId: number) {
    const [players, matches, past] = await Promise.all([
      db.select().from(playersTable).where(eq(playersTable.leagueId, leagueId)),
      db.select().from(matchesTable).where(eq(matchesTable.leagueId, leagueId)),
      getPastSeasonNames(leagueId),
    ]);
    const rows = computeStandings(players, matches, (season) => season === null || !past.includes(season));
    return rows.map((r) => ({ playerId: r.playerId, name: r.playerName, rank: r.rank }));
  }
}
