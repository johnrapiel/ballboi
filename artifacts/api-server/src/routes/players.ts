import { NextFunction, Request, Response, Router } from "express";
import { getAuth } from "@clerk/express";
import { db } from "@workspace/db";
import { playersTable, matchesTable, leaguesTable } from "@workspace/db";
import { UpdatePlayerBody } from "@workspace/api-zod";
import { eq, and, or, desc, inArray } from "drizzle-orm";
import { calculateStreaks } from "../lib/streakUtils.js";
import { accumulateScoreTotals, calculatePoints } from "../lib/scoringUtils.js";

const router = Router();

function requireAuth(req: Request, res: Response, next: NextFunction) {
  const { userId } = getAuth(req);
  if (!userId) return res.status(401).json({ error: "Unauthorized" });
  next();
}

function formatPlayer(player: typeof playersTable.$inferSelect, leagueName?: string | null) {
  const { clerkUserId, ...publicPlayer } = player;
  return {
    ...publicPlayer,
    email: player.email ?? null,
    phone: player.phone ?? null,
    bio: player.bio ?? null,
    leagueId: player.leagueId ?? null,
    createdAt: player.createdAt.toISOString(),
    updatedAt: player.updatedAt.toISOString(),
  };
}

router.get("/players", async (req, res) => {
  const leagueId = req.query.leagueId ? parseInt(req.query.leagueId as string) : null;

  if (leagueId && !isNaN(leagueId)) {
    const rows = await db.select().from(playersTable).where(eq(playersTable.leagueId, leagueId)).orderBy(desc(playersTable.wins));
    return res.json(rows.map((p) => formatPlayer(p)));
  }

  const rows = await db.select().from(playersTable).orderBy(desc(playersTable.wins));
  return res.json(rows.map((p) => formatPlayer(p)));
});

router.get("/players/me", requireAuth, async (req, res) => {
  const { userId } = getAuth(req);
  const rows = await db
    .select()
    .from(playersTable)
    .where(eq(playersTable.clerkUserId, userId!))
    .orderBy(desc(playersTable.wins));
  return res.json(rows.map((p) => formatPlayer(p)));
});

router.get("/players/:playerId", async (req, res) => {
  const playerId = parseInt(req.params.playerId);
  if (isNaN(playerId)) return res.status(400).json({ error: "Invalid id" });
  const [player] = await db.select().from(playersTable).where(eq(playersTable.id, playerId));
  if (!player) return res.status(404).json({ error: "Player not found" });
  return res.json(formatPlayer(player));
});

router.patch("/players/:playerId", requireAuth, async (req, res) => {
  const { userId } = getAuth(req);
  const playerId = parseInt(req.params.playerId);
  if (isNaN(playerId)) return res.status(400).json({ error: "Invalid id" });
  const parsed = UpdatePlayerBody.safeParse(req.body);
  if (!parsed.success) return res.status(400).json({ error: parsed.error.message });

  const [existingPlayer] = await db.select().from(playersTable).where(eq(playersTable.id, playerId));
  if (!existingPlayer) return res.status(404).json({ error: "Player not found" });

  const updatesReminderPreference = parsed.data.dayBeforeMatchReminderEnabled !== undefined;
  if (updatesReminderPreference && existingPlayer.clerkUserId !== userId) {
    return res.status(403).json({ error: "Only the linked player can update match reminder preferences" });
  }

  let canUpdate = existingPlayer.clerkUserId === userId;
  if (!canUpdate && existingPlayer.leagueId) {
    const [league] = await db.select().from(leaguesTable).where(eq(leaguesTable.id, existingPlayer.leagueId));
    canUpdate = league?.createdByClerkUserId === userId;
  }

  if (!canUpdate) {
    return res.status(403).json({ error: "You can only update your own player profile" });
  }

  const updates: Partial<typeof playersTable.$inferInsert> = {};
  if (parsed.data.name !== undefined && parsed.data.name !== null) updates.name = parsed.data.name;
  if (parsed.data.email !== undefined) updates.email = parsed.data.email ?? undefined;
  if (parsed.data.phone !== undefined) updates.phone = parsed.data.phone ?? undefined;
  if (parsed.data.bio !== undefined) updates.bio = parsed.data.bio ?? undefined;
  if (parsed.data.skillLevel !== undefined && parsed.data.skillLevel !== null) updates.skillLevel = parsed.data.skillLevel;
  if (parsed.data.dominantHand !== undefined && parsed.data.dominantHand !== null) updates.dominantHand = parsed.data.dominantHand;
  if (parsed.data.dayBeforeMatchReminderEnabled !== undefined && parsed.data.dayBeforeMatchReminderEnabled !== null) updates.dayBeforeMatchReminderEnabled = parsed.data.dayBeforeMatchReminderEnabled;
  if (parsed.data.leagueId !== undefined) updates.leagueId = parsed.data.leagueId ?? undefined;

  const [player] = await db.update(playersTable).set(updates).where(eq(playersTable.id, playerId)).returning();
  if (!player) return res.status(404).json({ error: "Player not found" });
  return res.json(formatPlayer(player));
});

router.delete("/players/:playerId", requireAuth, async (req, res) => {
  const { userId } = getAuth(req);
  const playerId = parseInt(req.params.playerId);
  if (isNaN(playerId)) return res.status(400).json({ error: "Invalid id" });

  const [existingPlayer] = await db.select().from(playersTable).where(eq(playersTable.id, playerId));
  if (!existingPlayer) return res.status(404).json({ error: "Player not found" });

  let canDelete = existingPlayer.clerkUserId === userId;
  if (!canDelete && existingPlayer.leagueId) {
    const [league] = await db.select().from(leaguesTable).where(eq(leaguesTable.id, existingPlayer.leagueId));
    canDelete = league?.createdByClerkUserId === userId;
  }

  if (!canDelete) {
    return res.status(403).json({ error: "You can only remove your own player profile or players in leagues you created" });
  }

  await db.delete(playersTable).where(eq(playersTable.id, playerId));
  return res.status(204).send();
});

router.get("/players/:playerId/stats", async (req, res) => {
  const playerId = parseInt(req.params.playerId);
  if (isNaN(playerId)) return res.status(400).json({ error: "Invalid id" });

  const [player] = await db.select().from(playersTable).where(eq(playersTable.id, playerId));
  if (!player) return res.status(404).json({ error: "Player not found" });

  const matches = await db
    .select()
    .from(matchesTable)
    .where(
      and(
        eq(matchesTable.status, "completed"),
        or(
          eq(matchesTable.player1Id, playerId),
          eq(matchesTable.player2Id, playerId),
          eq(matchesTable.player3Id, playerId),
          eq(matchesTable.player4Id, playerId),
        )
      )
    )
    .orderBy(desc(matchesTable.completedAt));

  // For doubles, winnerId is player1Id (team 1 won) or player2Id (team 2 won).
  // player3 is team 1's partner; player4 is team 2's partner.
  function playerWon(m: (typeof matches)[number]): boolean {
    if (m.winnerId === null) return false;
    if (m.winnerId === playerId) return true;
    if (m.player3Id === playerId && m.winnerId === m.player1Id) return true;
    if (m.player4Id === playerId && m.winnerId === m.player2Id) return true;
    return false;
  }

  const wins = matches.filter((m) => playerWon(m)).length;
  const losses = matches.filter((m) => m.winnerId !== null && !playerWon(m)).length;
  const winRate = wins + losses > 0 ? wins / (wins + losses) : 0;

  const scoreStrings = matches.map((m) => m.score);
  const isTeam1Array = matches.map(
    (m) => m.player1Id === playerId || m.player3Id === playerId,
  );
  const { gamesWon, gamesLost, setsWon, setsLost } = accumulateScoreTotals(
    scoreStrings,
    isTeam1Array,
  );

  // matches are ordered newest-first (desc completedAt)
  // currentStreak: positive = win streak, negative = loss streak
  // Only count matches that have a declared winner, matching the frontend filter.
  // Normalize winnerId so calculateStreaks can use simple equality (handles doubles).
  const decidedMatches = matches
    .filter((m) => m.winnerId !== null)
    .map((m) => ({ winnerId: playerWon(m) ? playerId : -1 }));
  const { currentStreak, longestWinStreak } = calculateStreaks(decidedMatches, playerId);

  const recentMatches = matches.slice(0, 10);

  const recentPlayerIds = [
    ...new Set(
      recentMatches.flatMap((m) =>
        [m.player1Id, m.player2Id, m.player3Id, m.player4Id].filter((id): id is number => id != null)
      )
    ),
  ];
  const playerMap: Record<number, string> = {};
  if (recentPlayerIds.length > 0) {
    const recentPlayers = await db.select().from(playersTable).where(inArray(playersTable.id, recentPlayerIds));
    for (const p of recentPlayers) playerMap[p.id] = p.name;
  }

  const leagueMap: Record<number, string> = {};
  const recentLeagueIds = recentMatches.flatMap((m) => (m.leagueId != null ? [m.leagueId] : []));
  const allLeagues = await db.select().from(leaguesTable).where(inArray(leaguesTable.id, recentLeagueIds));
  for (const l of allLeagues) leagueMap[l.id] = l.name;

  return res.json({
    playerId: player.id,
    name: player.name,
    totalMatches: matches.length,
    wins,
    losses,
    winRate,
    setsWon,
    setsLost,
    gamesWon,
    gamesLost,
    currentStreak,
    longestWinStreak,
    recentMatches: recentMatches.map((m) => ({
      ...m,
      leagueName: m.leagueId ? (leagueMap[m.leagueId] ?? null) : null,
      player1Name: playerMap[m.player1Id] ?? "Unknown",
      player2Name: playerMap[m.player2Id] ?? "Unknown",
      player3Name: m.player3Id != null ? (playerMap[m.player3Id] ?? "Unknown") : null,
      player4Name: m.player4Id != null ? (playerMap[m.player4Id] ?? "Unknown") : null,
      scheduledAt: m.scheduledAt ?? null,
      completedAt: m.completedAt ?? null,
      location: m.location ?? null,
      score: m.score ?? null,
      notes: m.notes ?? null,
      winnerId: m.winnerId ?? null,
      leagueId: m.leagueId ?? null,
      createdAt: m.createdAt.toISOString(),
      updatedAt: m.updatedAt.toISOString(),
    })),
  });
});

export default router;
