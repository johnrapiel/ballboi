import { Router } from "express";
import { getAuth } from "@clerk/express";
import { db } from "@workspace/db";
import { requireAdmin } from "../middlewares/requireAdmin";
import { matchesTable, playersTable, leaguesTable, scheduleGenerationLogsTable, ballBoiSessionsTable, matchStatisticsTable, leagueRoundsTable } from "@workspace/db";
import { eq, and, or, desc, inArray, ne, isNull } from "drizzle-orm";
import { getPlayerNameMap, getLeagueNameMap, matchPlayerIds } from "../lib/lookups.js";

const router = Router();

function getLinkedPlayerIdForMatch(
  match: Pick<typeof matchesTable.$inferSelect, "player1Id" | "player2Id" | "player3Id" | "player4Id">,
  linkedPlayerIds: Set<number>
) {
  if (linkedPlayerIds.has(match.player1Id)) return match.player1Id;
  if (linkedPlayerIds.has(match.player2Id)) return match.player2Id;
  if (match.player3Id != null && linkedPlayerIds.has(match.player3Id)) return match.player3Id;
  if (match.player4Id != null && linkedPlayerIds.has(match.player4Id)) return match.player4Id;
  return null;
}

router.get("/stats/dashboard", requireAdmin, async (req, res) => {
  const [leagues, players, matches] = await Promise.all([
    db.select().from(leaguesTable),
    db.select().from(playersTable),
    db.select().from(matchesTable).orderBy(desc(matchesTable.scheduledAt)),
  ]);

  const now = new Date();
  const weekStart = new Date(now);
  weekStart.setDate(now.getDate() - 7);

  const completedMatches = matches.filter((m) => m.status === "completed");
  const scheduledMatches = matches.filter((m) => m.status === "scheduled");
  const matchesThisWeek = completedMatches.filter((m) => {
    if (!m.completedAt) return false;
    return new Date(m.completedAt) >= weekStart;
  }).length;

  const playerMap: Record<number, string> = {};
  for (const p of players) playerMap[p.id] = p.name;
  const leagueMap: Record<number, string> = {};
  for (const l of leagues) leagueMap[l.id] = l.name;

  const upcoming = scheduledMatches.slice(0, 5).map((m) => ({
    ...m,
    player1Name: playerMap[m.player1Id] ?? "Unknown",
    player2Name: playerMap[m.player2Id] ?? "Unknown",
    leagueName: m.leagueId ? (leagueMap[m.leagueId] ?? null) : null,
    winnerId: m.winnerId ?? null,
    leagueId: m.leagueId ?? null,
    scheduledAt: m.scheduledAt ?? null,
    completedAt: m.completedAt ?? null,
    location: m.location ?? null,
    score: m.score ?? null,
    notes: m.notes ?? null,
    createdAt: m.createdAt.toISOString(),
    updatedAt: m.updatedAt.toISOString(),
  }));

  return res.json({
    totalLeagues: leagues.length,
    activeLeagues: leagues.filter((l) => l.status === "active").length,
    totalPlayers: players.length,
    totalMatches: matches.length,
    completedMatches: completedMatches.length,
    scheduledMatches: scheduledMatches.length,
    matchesThisWeek,
    upcomingMatches: upcoming,
  });
});

router.get("/stats/top-players", async (req, res) => {
  const leagueId = req.query.leagueId ? parseInt(req.query.leagueId as string) : null;
  const limit = req.query.limit ? parseInt(req.query.limit as string) : 10;

  const filterByLeague = leagueId != null && !isNaN(leagueId);
  const players = await db
    .select()
    .from(playersTable)
    .where(filterByLeague ? eq(playersTable.leagueId, leagueId!) : undefined);

  const leagueMap = await getLeagueNameMap(players.map((p) => p.leagueId));

  const playerIds = players.map((p) => p.id);
  const notExhibition = or(isNull(matchesTable.season), ne(matchesTable.season, "Spring Exhibition"));
  const completedMatches = playerIds.length
    ? await db
        .select()
        .from(matchesTable)
        .where(
          and(
            eq(matchesTable.status, "completed"),
            notExhibition,
            // Without a league filter every player is in scope, so skip the participant check.
            filterByLeague
              ? or(
                  inArray(matchesTable.player1Id, playerIds),
                  inArray(matchesTable.player2Id, playerIds),
                  inArray(matchesTable.player3Id, playerIds),
                  inArray(matchesTable.player4Id, playerIds),
                )
              : undefined,
          ),
        )
    : [];

  const statsMap: Record<number, { wins: number; losses: number }> = {};
  for (const p of players) statsMap[p.id] = { wins: 0, losses: 0 };

  for (const m of completedMatches) {
    if (m.winnerId == null) continue;
    const participants = [m.player1Id, m.player2Id, m.player3Id, m.player4Id].filter((id): id is number => id != null);
    for (const pid of participants) {
      if (!statsMap[pid]) continue;
      const won =
        m.winnerId === pid ||
        (m.player3Id === pid && m.winnerId === m.player1Id) ||
        (m.player4Id === pid && m.winnerId === m.player2Id);
      if (won) statsMap[pid].wins++;
      else statsMap[pid].losses++;
    }
  }

  const ranked = players
    .map((p) => {
      const { wins, losses } = statsMap[p.id] ?? { wins: 0, losses: 0 };
      return {
        playerId: p.id,
        name: p.name,
        wins,
        losses,
        winRate: wins + losses > 0 ? wins / (wins + losses) : 0,
        skillLevel: p.skillLevel,
        leagueName: p.leagueId ? (leagueMap[p.leagueId] ?? null) : null,
      };
    })
    .sort((a, b) => b.wins - a.wins || b.winRate - a.winRate)
    .slice(0, limit);

  return res.json(ranked);
});

router.get("/stats/recent-activity", async (req, res) => {
  const limit = req.query.limit ? parseInt(req.query.limit as string) : 20;
  const matches = await db
    .select()
    .from(matchesTable)
    .where(eq(matchesTable.status, "completed"))
    .orderBy(desc(matchesTable.updatedAt))
    .limit(limit);

  const [playerMap, leagueMap] = await Promise.all([
    getPlayerNameMap(matches.flatMap(matchPlayerIds)),
    getLeagueNameMap(matches.map((m) => m.leagueId)),
  ]);

  return res.json(
    matches.map((m) => ({
      matchId: m.id,
      player1Name: playerMap[m.player1Id] ?? "Unknown",
      player2Name: playerMap[m.player2Id] ?? "Unknown",
      winnerName: m.winnerId ? (playerMap[m.winnerId] ?? null) : null,
      score: m.score ?? null,
      leagueName: m.leagueId ? (leagueMap[m.leagueId] ?? null) : null,
      status: m.status,
      completedAt: m.completedAt ?? null,
      scheduledAt: m.scheduledAt ?? null,
    }))
  );
});

router.get("/stats/head-to-head", async (req, res) => {
  const player1Id = parseInt(req.query.player1Id as string);
  const player2Id = parseInt(req.query.player2Id as string);
  if (isNaN(player1Id) || isNaN(player2Id)) return res.status(400).json({ error: "Invalid player IDs" });

  const [p1, p2] = await Promise.all([
    db.select().from(playersTable).where(eq(playersTable.id, player1Id)).then((r) => r[0]),
    db.select().from(playersTable).where(eq(playersTable.id, player2Id)).then((r) => r[0]),
  ]);
  if (!p1 || !p2) return res.status(404).json({ error: "Player not found" });

  const matches = await db
    .select()
    .from(matchesTable)
    .where(
      and(
        eq(matchesTable.status, "completed"),
        or(
          and(eq(matchesTable.player1Id, player1Id), eq(matchesTable.player2Id, player2Id)),
          and(eq(matchesTable.player1Id, player2Id), eq(matchesTable.player2Id, player1Id))
        )
      )
    )
    .orderBy(desc(matchesTable.completedAt));

  const leagueMap = await getLeagueNameMap(matches.map((m) => m.leagueId));

  const player1Wins = matches.filter((m) => m.winnerId === player1Id).length;
  const player2Wins = matches.filter((m) => m.winnerId === player2Id).length;

  return res.json({
    player1Id,
    player1Name: p1.name,
    player2Id,
    player2Name: p2.name,
    player1Wins,
    player2Wins,
    totalMatches: matches.length,
    matches: matches.map((m) => ({
      ...m,
      player1Name: m.player1Id === player1Id ? p1.name : p2.name,
      player2Name: m.player2Id === player2Id ? p2.name : p1.name,
      leagueName: m.leagueId ? (leagueMap[m.leagueId] ?? null) : null,
      winnerId: m.winnerId ?? null,
      leagueId: m.leagueId ?? null,
      scheduledAt: m.scheduledAt ?? null,
      completedAt: m.completedAt ?? null,
      location: m.location ?? null,
      score: m.score ?? null,
      notes: m.notes ?? null,
      createdAt: m.createdAt.toISOString(),
      updatedAt: m.updatedAt.toISOString(),
    })),
  });
});

router.get("/stats/my-matches", async (req, res) => {
  try {
    const { userId } = getAuth(req);

    let linkedPlayers: (typeof playersTable.$inferSelect)[] = [];
    if (userId) {
      linkedPlayers = await db
        .select()
        .from(playersTable)
        .where(eq(playersTable.clerkUserId, userId));
    }

    if (linkedPlayers.length === 0) {
      return res.json({ playerId: null, playerIds: [], upcoming: [], past: [] });
    }

    const playerIds = linkedPlayers.map((player) => player.id);
    const allMatches = await db
      .select()
      .from(matchesTable)
      .where(
        or(
          inArray(matchesTable.player1Id, playerIds),
          inArray(matchesTable.player2Id, playerIds),
          inArray(matchesTable.player3Id, playerIds),
          inArray(matchesTable.player4Id, playerIds),
        )
      )
      .orderBy(desc(matchesTable.scheduledAt));

    const [allLeagues, allPlayers, ballBoiSessions, ballBoiStats, allRounds] = await Promise.all([
      db.select().from(leaguesTable).where(inArray(leaguesTable.id, allMatches.flatMap((m) => (m.leagueId != null ? [m.leagueId] : [])))),
      db.select().from(playersTable).where(inArray(playersTable.id, allMatches.flatMap((m) => [m.player1Id, m.player2Id]))),
      allMatches.length ? db.select().from(ballBoiSessionsTable).where(inArray(ballBoiSessionsTable.matchId, allMatches.map((m) => m.id))) : Promise.resolve([]),
      allMatches.length ? db.select().from(matchStatisticsTable).where(inArray(matchStatisticsTable.matchId, allMatches.map((m) => m.id))) : Promise.resolve([]),
      db.select().from(leagueRoundsTable).where(inArray(leagueRoundsTable.id, allMatches.flatMap((m) => (m.roundId != null ? [m.roundId] : [])))),
    ]);

    const leagueMap: Record<number, string> = {};
    for (const l of allLeagues) leagueMap[l.id] = l.name;
    const playerMap: Record<number, string> = {};
    for (const p of allPlayers) playerMap[p.id] = p.name;
    const ballBoiByMatch: Record<number, typeof ballBoiSessions[number]> = {};
    for (const session of ballBoiSessions) {
      const current = ballBoiByMatch[session.matchId];
      if (!current || session.createdAt > current.createdAt) ballBoiByMatch[session.matchId] = session;
    }
    const ballBoiStatsByMatch: Record<number, typeof ballBoiStats[number]> = {};
    for (const stat of ballBoiStats) ballBoiStatsByMatch[stat.matchId] = stat;
    const roundById: Record<number, typeof allRounds[number]> = {};
    for (const r of allRounds) roundById[r.id] = r;

    const linkedPlayerIdSet = new Set(playerIds);
    function buildMatchItem(m: typeof allMatches[0]) {
      const matchPlayerId = getLinkedPlayerIdForMatch(m, linkedPlayerIdSet) ?? playerIds[0];
      const onTeam1 = m.player1Id === matchPlayerId || m.player3Id === matchPlayerId;
      const opponentId = onTeam1 ? m.player2Id : m.player1Id;
      const ballBoiSession = ballBoiByMatch[m.id] ?? null;
      const ballBoiStat = ballBoiStatsByMatch[m.id] ?? null;
      return {
        matchId: m.id,
        playerId: matchPlayerId,
        player1Id: m.player1Id,
        player1Name: playerMap[m.player1Id] ?? "Unknown",
        player2Id: m.player2Id,
        player2Name: playerMap[m.player2Id] ?? "Unknown",
        opponentId,
        opponentName: playerMap[opponentId] ?? "Unknown",
        scheduledAt: m.scheduledAt ?? null,
        status: m.status,
        leagueId: m.leagueId ?? null,
        leagueName: m.leagueId ? (leagueMap[m.leagueId] ?? null) : null,
        location: m.location ?? null,
        score: m.score ?? null,
        winnerId: m.winnerId ?? null,
        hasBallBoiReplay: !!ballBoiSession,
        ballBoiProcessingStatus: ballBoiSession?.processingStatus ?? null,
        ballBoiShotCount: ballBoiStat?.totalShots ?? null,
        ballBoiAvgShotSpeedMph: ballBoiStat?.avgShotSpeedMph ?? null,
        roundId: m.roundId ?? null,
        roundNumber: m.roundId ? (roundById[m.roundId]?.roundNumber ?? null) : null,
        playoffBracketId: m.playoffBracketId ?? null,
        playoffRound: m.playoffRound ?? null,
        season: m.season ?? null,
      };
    }

    const upcoming = allMatches
      .filter((m) => m.status === "scheduled" || m.status === "in_progress")
      .sort((a, b) => {
        if (!a.scheduledAt) return 1;
        if (!b.scheduledAt) return -1;
        return a.scheduledAt.localeCompare(b.scheduledAt);
      })
      .map(buildMatchItem);

    const past = allMatches
      .filter((m) => m.status === "completed" || m.status === "cancelled")
      .sort((a, b) => {
        const aDate = a.completedAt ?? a.scheduledAt ?? "";
        const bDate = b.completedAt ?? b.scheduledAt ?? "";
        return bDate.localeCompare(aDate);
      })
      .map(buildMatchItem);

    return res.json({ playerId: playerIds[0], playerIds, upcoming, past });
  } catch (err) {
    console.error("my-matches error:", err);
    return res.status(500).json({ error: "Failed to fetch matches" });
  }
});

router.get("/stats/my-schedule", async (req, res) => {
  try {
    const { userId } = getAuth(req);

    // Find every player profile linked to this Clerk user
    let linkedPlayers: (typeof playersTable.$inferSelect)[] = [];
    if (userId) {
      linkedPlayers = await db
        .select()
        .from(playersTable)
        .where(eq(playersTable.clerkUserId, userId));
    }

    if (linkedPlayers.length === 0) {
      return res.json({ playerId: null, playerIds: [], match: null });
    }

    const playerIds = linkedPlayers.map((player) => player.id);
    const linkedPlayerIdSet = new Set(playerIds);

    // Compute current weekOf (Monday of current week, YYYY-MM-DD)
    const today = new Date();
    const dayOfWeek = today.getDay(); // 0=Sun
    const diffToMonday = dayOfWeek === 0 ? -6 : 1 - dayOfWeek;
    const monday = new Date(today);
    monday.setDate(today.getDate() + diffToMonday);
    const currentWeekOf = monday.toISOString().slice(0, 10);

    // 1. Try to find a match from a confirmed schedule for the current week.
    //    Check ALL confirmed logs for the week (multi-league: player may be in any).
    const confirmedLogs = await db
      .select()
      .from(scheduleGenerationLogsTable)
      .where(
        and(
          eq(scheduleGenerationLogsTable.weekOf, currentWeekOf),
          eq(scheduleGenerationLogsTable.status, "confirmed")
        )
      );

    const now = new Date().toISOString();
    // Compute end of current week (Sunday 23:59:59)
    const sunday = new Date(monday);
    sunday.setDate(monday.getDate() + 6);
    sunday.setHours(23, 59, 59, 999);
    const weekEnd = sunday.toISOString();

    let upcoming: typeof matchesTable.$inferSelect | null = null;

    if (confirmedLogs.length > 0) {
      const confirmedLeagueIds = confirmedLogs.map((l) => l.leagueId);
      // Fetch all current-week matches across all confirmed leagues, ordered soonest first.
      const weekMatches = await db
        .select()
        .from(matchesTable)
        .where(eq(matchesTable.weekOf, currentWeekOf))
        .orderBy(matchesTable.scheduledAt);
      const isPlayerMatch = (m: typeof weekMatches[0]) =>
        confirmedLeagueIds.includes(m.leagueId!) &&
        getLinkedPlayerIdForMatch(m, linkedPlayerIdSet) != null &&
        m.status !== "cancelled" &&
        m.status !== "completed";

      // Priority: 1) In-progress now  2) Next future scheduled  3) Unscheduled placeholder
      upcoming =
        weekMatches.find((m) => isPlayerMatch(m) && m.status === "in_progress") ??
        weekMatches.find((m) => isPlayerMatch(m) && m.scheduledAt != null && m.scheduledAt >= now) ??
        weekMatches.find((m) => isPlayerMatch(m) && m.scheduledAt == null) ??
        null;
    }

    // 2. Fallback: any scheduled or in-progress match in the current week window
    if (!upcoming) {
      const allActiveThisWeek = await db
        .select()
        .from(matchesTable)
        .where(
          and(
            inArray(matchesTable.status, ["scheduled", "in_progress"]),
            or(
              inArray(matchesTable.player1Id, playerIds),
              inArray(matchesTable.player2Id, playerIds),
              inArray(matchesTable.player3Id, playerIds),
              inArray(matchesTable.player4Id, playerIds),
            ),
          ),
        )
        .orderBy(matchesTable.scheduledAt);

      upcoming = allActiveThisWeek.find(
        (m) =>
          getLinkedPlayerIdForMatch(m, linkedPlayerIdSet) != null &&
          m.scheduledAt != null &&
          // In-progress: started this week; scheduled: still upcoming this week
          m.scheduledAt >= monday.toISOString() &&
          m.scheduledAt <= weekEnd
      ) ?? null;
    }

    // No current-week match → card shows "no matches this week"

    if (!upcoming) {
      return res.json({ playerId: playerIds[0], playerIds, match: null });
    }

    // Load related data
    const [allLeagues, allPlayers] = await Promise.all([
      db.select().from(leaguesTable).where(inArray(leaguesTable.id, upcoming.leagueId != null ? [upcoming.leagueId] : [])),
      db.select().from(playersTable).where(
        inArray(playersTable.id, [upcoming.player1Id, upcoming.player2Id, upcoming.player3Id, upcoming.player4Id].filter((id): id is number => id != null)),
      ),
    ]);

    const leagueMap: Record<number, string> = {};
    for (const l of allLeagues) leagueMap[l.id] = l.name;

    const playerMap: Record<number, string> = {};
    for (const p of allPlayers) playerMap[p.id] = p.name;

    // Determine which team the current player is on (team1=p1/p3, team2=p2/p4)
    const matchPlayerId = getLinkedPlayerIdForMatch(upcoming, linkedPlayerIdSet) ?? playerIds[0];
    const onTeam1 =
      upcoming.player1Id === matchPlayerId || upcoming.player3Id === matchPlayerId;
    const opponentId = onTeam1 ? upcoming.player2Id : upcoming.player1Id;
    const opponentName = playerMap[opponentId] ?? "Unknown";

    return res.json({
      playerId: matchPlayerId,
      playerIds,
      match: {
        matchId: upcoming.id,
        playerId: matchPlayerId,
        player1Id: upcoming.player1Id,
        player1Name: playerMap[upcoming.player1Id] ?? "Unknown",
        player2Id: upcoming.player2Id,
        player2Name: playerMap[upcoming.player2Id] ?? "Unknown",
        opponentId,
        opponentName,
        scheduledAt: upcoming.scheduledAt ?? null,
        status: upcoming.status,
        leagueId: upcoming.leagueId ?? null,
        leagueName: upcoming.leagueId ? (leagueMap[upcoming.leagueId] ?? null) : null,
        location: upcoming.location ?? null,
        score: upcoming.score ?? null,
        winnerId: upcoming.winnerId ?? null,
      },
    });
  } catch (err) {
    console.error("my-schedule error:", err);
    return res.status(500).json({ error: "Failed to fetch schedule" });
  }
});

export default router;
