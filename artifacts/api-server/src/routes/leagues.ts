import { Router, Request, Response, NextFunction } from "express";
import { getAuth } from "@clerk/express";
import { db } from "@workspace/db";
import { leaguesTable, playersTable, matchesTable, leagueRoundsTable } from "@workspace/db";
import { CreateLeagueBody, UpdateLeagueBody } from "@workspace/api-zod";
import { eq, count } from "drizzle-orm";
import { autoLinkPlayer } from "../lib/autoLinkPlayer.js";
import { requireAdmin } from "../middlewares/requireAdmin.js";
import { getPastSeasonNames } from "../services/seasonService.js";
import { accumulateScoreTotals, calculatePoints } from "../lib/scoringUtils.js";

function requireAuth(req: Request, res: Response, next: NextFunction) {
  const { userId } = getAuth(req);
  if (!userId) return res.status(401).json({ error: "Unauthorized" });
  next();
}

const router = Router();

router.get("/leagues", async (req, res) => {
  const clerkUserId = req.query.clerkUserId as string | undefined;
  let leagues = await db.select().from(leaguesTable).orderBy(leaguesTable.createdAt);

  if (clerkUserId) {
    const memberPlayers = await db
      .select({ leagueId: playersTable.leagueId })
      .from(playersTable)
      .where(eq(playersTable.clerkUserId, clerkUserId));
    const memberLeagueIds = memberPlayers
      .map((p) => p.leagueId)
      .filter((id): id is number => id !== null);
    leagues = leagues.filter(
      (l) => l.createdByClerkUserId === clerkUserId || memberLeagueIds.includes(l.id)
    );
  }

  const playerCounts = await db
    .select({ leagueId: playersTable.leagueId, count: count() })
    .from(playersTable)
    .groupBy(playersTable.leagueId);

  const matchCounts = await db
    .select({ leagueId: matchesTable.leagueId, count: count() })
    .from(matchesTable)
    .groupBy(matchesTable.leagueId);

  const pcMap: Record<number, number> = {};
  for (const pc of playerCounts) {
    if (pc.leagueId !== null) pcMap[pc.leagueId] = Number(pc.count);
  }
  const mcMap: Record<number, number> = {};
  for (const mc of matchCounts) {
    if (mc.leagueId !== null) mcMap[mc.leagueId] = Number(mc.count);
  }

  return res.json(
    leagues.map((l) => ({
      ...l,
      startDate: l.startDate ?? null,
      endDate: l.endDate ?? null,
      location: l.location ?? null,
      description: l.description ?? null,
      leagueType: l.leagueType ?? "singles",
      createdByClerkUserId: l.createdByClerkUserId ?? null,
      playerCount: pcMap[l.id] ?? 0,
      matchCount: mcMap[l.id] ?? 0,
      createdAt: l.createdAt.toISOString(),
      updatedAt: l.updatedAt.toISOString(),
    }))
  );
});

router.post("/leagues", requireAdmin, async (req, res) => {
  const parsed = CreateLeagueBody.safeParse(req.body);
  if (!parsed.success) {
    return res.status(400).json({ error: parsed.error.message });
  }
  const insertData = {
    ...parsed.data,
    leagueType: parsed.data.leagueType ?? "singles",
    createdByClerkUserId: parsed.data.createdByClerkUserId ?? undefined,
  };
  const [league] = await db.insert(leaguesTable).values(insertData).returning();
  return res.status(201).json({
    ...league,
    startDate: league.startDate ?? null,
    endDate: league.endDate ?? null,
    location: league.location ?? null,
    description: league.description ?? null,
    leagueType: league.leagueType ?? "singles",
    createdByClerkUserId: league.createdByClerkUserId ?? null,
    playerCount: 0,
    matchCount: 0,
    createdAt: league.createdAt.toISOString(),
    updatedAt: league.updatedAt.toISOString(),
  });
});

router.get("/leagues/:leagueId", async (req, res) => {
  const leagueId = parseInt(req.params.leagueId);
  if (isNaN(leagueId)) return res.status(400).json({ error: "Invalid id" });
  const [league] = await db.select().from(leaguesTable).where(eq(leaguesTable.id, leagueId));
  if (!league) return res.status(404).json({ error: "League not found" });

  const [pc] = await db.select({ count: count() }).from(playersTable).where(eq(playersTable.leagueId, leagueId));
  const [mc] = await db.select({ count: count() }).from(matchesTable).where(eq(matchesTable.leagueId, leagueId));

  return res.json({
    ...league,
    startDate: league.startDate ?? null,
    endDate: league.endDate ?? null,
    location: league.location ?? null,
    description: league.description ?? null,
    leagueType: league.leagueType ?? "singles",
    playerCount: Number(pc?.count ?? 0),
    matchCount: Number(mc?.count ?? 0),
    createdAt: league.createdAt.toISOString(),
    updatedAt: league.updatedAt.toISOString(),
  });
});

router.patch("/leagues/:leagueId", requireAdmin, async (req, res) => {
  const leagueId = parseInt(req.params.leagueId);
  if (isNaN(leagueId)) return res.status(400).json({ error: "Invalid id" });
  if ("leagueType" in req.body) {
    return res.status(400).json({ error: "leagueType cannot be changed after a league is created" });
  }
  const parsed = UpdateLeagueBody.safeParse(req.body);
  if (!parsed.success) return res.status(400).json({ error: parsed.error.message });

  const updates: Partial<typeof leaguesTable.$inferInsert> = {};
  if (parsed.data.name !== undefined && parsed.data.name !== null) updates.name = parsed.data.name;
  if (parsed.data.description !== undefined) updates.description = parsed.data.description ?? undefined;
  if (parsed.data.format !== undefined && parsed.data.format !== null) updates.format = parsed.data.format;
  if (parsed.data.status !== undefined && parsed.data.status !== null) updates.status = parsed.data.status;
  if (parsed.data.startDate !== undefined) updates.startDate = parsed.data.startDate ?? undefined;
  if (parsed.data.endDate !== undefined) updates.endDate = parsed.data.endDate ?? undefined;
  if (parsed.data.location !== undefined) updates.location = parsed.data.location ?? undefined;

  const [league] = await db.update(leaguesTable).set(updates).where(eq(leaguesTable.id, leagueId)).returning();
  if (!league) return res.status(404).json({ error: "League not found" });

  const [pc] = await db.select({ count: count() }).from(playersTable).where(eq(playersTable.leagueId, leagueId));
  const [mc] = await db.select({ count: count() }).from(matchesTable).where(eq(matchesTable.leagueId, leagueId));

  return res.json({
    ...league,
    startDate: league.startDate ?? null,
    endDate: league.endDate ?? null,
    location: league.location ?? null,
    description: league.description ?? null,
    leagueType: league.leagueType ?? "singles",
    playerCount: Number(pc?.count ?? 0),
    matchCount: Number(mc?.count ?? 0),
    createdAt: league.createdAt.toISOString(),
    updatedAt: league.updatedAt.toISOString(),
  });
});

router.delete("/leagues/:leagueId", requireAdmin, async (req, res) => {
  const leagueId = parseInt(req.params.leagueId);
  if (isNaN(leagueId)) return res.status(400).json({ error: "Invalid id" });
  await db.delete(leaguesTable).where(eq(leaguesTable.id, leagueId));
  return res.status(204).send();
});

router.post("/leagues/:leagueId/reset", requireAdmin, async (req, res) => {
  const leagueId = parseInt(req.params.leagueId);
  if (isNaN(leagueId)) return res.status(400).json({ error: "Invalid id" });

  const [league] = await db.select({ id: leaguesTable.id }).from(leaguesTable).where(eq(leaguesTable.id, leagueId));
  if (!league) return res.status(404).json({ error: "League not found" });

  const deletedRounds = await db
    .delete(leagueRoundsTable)
    .where(eq(leagueRoundsTable.leagueId, leagueId))
    .returning({ id: leagueRoundsTable.id });

  return res.json({ deleted: { rounds: deletedRounds.length } });
});

router.get("/leagues/:leagueId/standings", async (req, res) => {
  const leagueId = parseInt(req.params.leagueId);
  if (isNaN(leagueId)) return res.status(400).json({ error: "Invalid id" });

  const seasonFilter = typeof req.query.season === "string" ? req.query.season : undefined;
  const pastSeasonNames = seasonFilter ? [] : await getPastSeasonNames(leagueId);

  const players = await db.select().from(playersTable).where(eq(playersTable.leagueId, leagueId));
  const matches = await db
    .select()
    .from(matchesTable)
    .where(eq(matchesTable.leagueId, leagueId));

  const standings = players.map((player) => {
    const playerMatches = matches.filter((m) => {
      if (m.status !== "completed") return false;
      if (
        m.player1Id !== player.id &&
        m.player2Id !== player.id &&
        m.player3Id !== player.id &&
        m.player4Id !== player.id
      ) return false;
      if (seasonFilter === "all") return true;
      if (seasonFilter) return m.season === seasonFilter;
      return m.season === null || !pastSeasonNames.includes(m.season);
    });
    // For doubles, a player "wins" if their team won:
    // Team 1 = player1 + player3, Team 2 = player2 + player4
    // winnerId is the first player of the winning team (player1Id or player2Id)
    const wins = playerMatches.filter((m) => {
      if (m.winnerId === null) return false;
      if (m.winnerId === player.id) return true;
      // doubles partner credit
      if (m.player3Id === player.id && m.winnerId === m.player1Id) return true;
      if (m.player4Id === player.id && m.winnerId === m.player2Id) return true;
      return false;
    }).length;
    const losses = playerMatches.filter((m) => {
      if (m.winnerId === null) return false;
      const playerWon =
        m.winnerId === player.id ||
        (m.player3Id === player.id && m.winnerId === m.player1Id) ||
        (m.player4Id === player.id && m.winnerId === m.player2Id);
      return !playerWon;
    }).length;
    const matchesPlayed = wins + losses;
    const winRate = matchesPlayed > 0 ? wins / matchesPlayed : 0;

    // Team 1 = player1 + player3; Team 2 = player2 + player4
    const scoreStrings = playerMatches.map((m) => m.score);
    const isTeam1Array = playerMatches.map(
      (m) => m.player1Id === player.id || m.player3Id === player.id,
    );
    const { gamesWon, gamesLost, setsWon, setsLost } = accumulateScoreTotals(
      scoreStrings,
      isTeam1Array,
    );

    // Ladder scoring: 1 pt per game won + 3 pts per set won + 6 bonus pts for match win
    const points = calculatePoints({ gamesWon, gamesLost, setsWon, setsLost }, wins);

    return {
      playerId: player.id,
      playerName: player.name,
      wins,
      losses,
      matchesPlayed,
      points,
      winRate,
      setsWon,
      setsLost,
      gamesWon,
      gamesLost,
    };
  });

  standings.sort((a, b) => b.points - a.points || b.winRate - a.winRate);
  const ranked = standings.map((s, i) => ({ ...s, rank: i + 1 }));
  return res.json(ranked);
});

router.post("/leagues/:leagueId/players", requireAuth, async (req: Request, res: Response) => {
  const leagueId = parseInt(req.params.leagueId);
  if (isNaN(leagueId)) return res.status(400).json({ error: "Invalid league ID" });

  const { userId } = getAuth(req);
  const [league] = await db.select().from(leaguesTable).where(eq(leaguesTable.id, leagueId));
  if (!league) return res.status(404).json({ error: "League not found" });
  if (league.createdByClerkUserId !== userId) {
    return res.status(403).json({ error: "Only the league creator can add players directly" });
  }

  const { name, email, phone, skillLevel, dominantHand, bio } = req.body;
  if (!name?.trim()) return res.status(400).json({ error: "name is required" });

  const allowedSkillLevels = new Set(["2.5", "3.0", "3.5", "4.0", "4.5", "5.0"]);

  const [inserted] = await db
    .insert(playersTable)
    .values({
      name: name.trim(),
      email: email ?? null,
      phone: phone ?? null,
      bio: bio ?? null,
      skillLevel: allowedSkillLevels.has(skillLevel) ? skillLevel : "3.0",
      dominantHand: dominantHand ?? "right",
      leagueId,
    })
    .returning();

  const linked = await autoLinkPlayer(inserted);

  const { clerkUserId: _omit, ...publicPlayer } = {
    ...inserted,
    clerkUserId: linked ?? inserted.clerkUserId,
  };

  return res.status(201).json({
    ...publicPlayer,
    autoLinked: !!linked,
    createdAt: inserted.createdAt.toISOString(),
    updatedAt: inserted.updatedAt.toISOString(),
  });
});

export default router;
