import { NextFunction, Request, Response, Router } from "express";
import { getAuth } from "@clerk/express";
import { db } from "@workspace/db";
import { playersTable, matchesTable, leaguesTable } from "@workspace/db";
import { UpdatePlayerBody } from "@workspace/api-zod";
import { eq, and, or, desc, inArray } from "drizzle-orm";
import { calculateStreaks } from "../lib/streakUtils.js";
import { accumulateScoreTotals, calculatePoints } from "../lib/scoringUtils.js";
import { blockedAccountsFor } from "../lib/blocks.js";
import { isLeagueAdmin, PRIVATE_LEAGUE } from "../lib/leagueAccess.js";
import { canSeeContact, canSeePlayer, readScope } from "../lib/matchAccess.js";
import { DELETED_PLAYER_NAME } from "../lib/deletedPlayer.js";

const router = Router();

function requireAuth(req: Request, res: Response, next: NextFunction) {
  const { userId } = getAuth(req);
  if (!userId) { res.status(401).json({ error: "Unauthorized" }); return; }
  next();
}

// Contact details go only to the player themselves and their league's admins.
function formatPlayer(player: typeof playersTable.$inferSelect, showContact: boolean) {
  const { clerkUserId, ...publicPlayer } = player;
  return {
    ...publicPlayer,
    email: showContact ? (player.email ?? null) : null,
    phone: showContact ? (player.phone ?? null) : null,
    bio: player.bio ?? null,
    leagueId: player.leagueId ?? null,
    createdAt: player.createdAt.toISOString(),
    updatedAt: player.updatedAt.toISOString(),
  };
}

// Signed in only: players in leagues the caller can see, and their own records.
router.get("/players", requireAuth, async (req, res) => {
  const { userId } = getAuth(req);
  const scope = await readScope(userId!, { openLeagues: true });
  const leagueId = req.query.leagueId ? parseInt(req.query.leagueId as string) : null;

  if (leagueId && !isNaN(leagueId)) {
    if (!scope.leagueIds.includes(leagueId)) { res.status(403).json({ error: PRIVATE_LEAGUE }); return; }
    const rows = await db.select().from(playersTable).where(eq(playersTable.leagueId, leagueId)).orderBy(desc(playersTable.wins));
    { res.json(rows.map((p) => formatPlayer(p, canSeeContact(scope, p)))); return; }
  }

  const rows = await db
    .select()
    .from(playersTable)
    .where(or(
      inArray(playersTable.leagueId, scope.leagueIds.length ? scope.leagueIds : [-1]),
      inArray(playersTable.id, scope.myPlayerIds.length ? scope.myPlayerIds : [-1]),
    ))
    .orderBy(desc(playersTable.wins));
  // Player discovery hides anyone the viewer blocked or was blocked by.
  // League rosters above stay complete so standings remain accurate.
  const hidden = await blockedAccountsFor(userId!);
  { res.json(rows.filter((p) => !p.clerkUserId || !hidden.has(p.clerkUserId)).map((p) => formatPlayer(p, canSeeContact(scope, p)))); return; }
});

router.get("/players/me", requireAuth, async (req, res) => {
  const { userId } = getAuth(req);
  const rows = await db
    .select()
    .from(playersTable)
    .where(eq(playersTable.clerkUserId, userId!))
    .orderBy(desc(playersTable.wins));
  { res.json(rows.map((p) => formatPlayer(p, true))); return; }
});

router.get("/players/:playerId", requireAuth, async (req, res) => {
  const playerId = parseInt(String(req.params.playerId));
  if (isNaN(playerId)) { res.status(400).json({ error: "Invalid id" }); return; }
  const [player] = await db.select().from(playersTable).where(eq(playersTable.id, playerId));
  const scope = await readScope(getAuth(req).userId!, { openLeagues: true });
  // Same answer for a player who doesn't exist and one the caller can't see.
  if (!player || !canSeePlayer(scope, player)) { res.status(404).json({ error: "Player not found" }); return; }
  { res.json(formatPlayer(player, canSeeContact(scope, player))); return; }
});

router.patch("/players/:playerId", requireAuth, async (req, res) => {
  const { userId } = getAuth(req);
  const playerId = parseInt(String(req.params.playerId));
  if (isNaN(playerId)) { res.status(400).json({ error: "Invalid id" }); return; }
  const parsed = UpdatePlayerBody.safeParse(req.body);
  if (!parsed.success) { res.status(400).json({ error: parsed.error.message }); return; }

  const [existingPlayer] = await db.select().from(playersTable).where(eq(playersTable.id, playerId));
  if (!existingPlayer) { res.status(404).json({ error: "Player not found" }); return; }

  // Linking and league membership change only through invites, join
  // requests and Manage, never here.
  if (parsed.data.leagueId !== undefined || "clerkUserId" in (req.body ?? {})) {
    { res.status(400).json({ error: "A player's league and account can't be changed here." }); return; }
  }
  if (!existingPlayer.clerkUserId && existingPlayer.name === DELETED_PLAYER_NAME) {
    { res.status(409).json({ error: "This player deleted their account." }); return; }
  }

  // Who's asking: the player's own account, and/or an admin of their league.
  const isSelf = existingPlayer.clerkUserId === userId;
  const isAdmin = existingPlayer.leagueId != null && (await isLeagueAdmin(existingPlayer.leagueId, userId!));
  if (!isSelf && !isAdmin) {
    { res.status(403).json({ error: "You can only update your own player profile" }); return; }
  }
  if (parsed.data.dayBeforeMatchReminderEnabled !== undefined && !isSelf) {
    { res.status(403).json({ error: "Only the linked player can update match reminder preferences" }); return; }
  }
  // An admin edits contact details only for players who haven't signed up;
  // once linked, those belong to the player.
  const touchesContact = parsed.data.email !== undefined || parsed.data.phone !== undefined || parsed.data.bio !== undefined;
  if (touchesContact && !isSelf && existingPlayer.clerkUserId) {
    { res.status(403).json({ error: "Only the player can change their own contact details" }); return; }
  }

  const updates: Partial<typeof playersTable.$inferInsert> = {};
  if (parsed.data.name !== undefined && parsed.data.name !== null) updates.name = parsed.data.name;
  if (parsed.data.email !== undefined) updates.email = parsed.data.email ?? undefined;
  if (parsed.data.phone !== undefined) updates.phone = parsed.data.phone ?? undefined;
  if (parsed.data.bio !== undefined) updates.bio = parsed.data.bio ?? undefined;
  if (parsed.data.skillLevel !== undefined && parsed.data.skillLevel !== null) updates.skillLevel = parsed.data.skillLevel;
  if (parsed.data.dominantHand !== undefined && parsed.data.dominantHand !== null) updates.dominantHand = parsed.data.dominantHand;
  if (parsed.data.dayBeforeMatchReminderEnabled !== undefined && parsed.data.dayBeforeMatchReminderEnabled !== null) updates.dayBeforeMatchReminderEnabled = parsed.data.dayBeforeMatchReminderEnabled;
  if (Object.keys(updates).length === 0) { res.status(400).json({ error: "Nothing to change." }); return; }

  const [player] = await db.update(playersTable).set(updates).where(eq(playersTable.id, playerId)).returning();
  if (!player) { res.status(404).json({ error: "Player not found" }); return; }
  { res.json(formatPlayer(player, true)); return; }
});

// League admins only. A player who has played (or is scheduled for) any match
// can't be hard-deleted, since that would orphan match history; use the
// remove-player flow in Manage (POST /leagues/:leagueId/players/:playerId/remove).
router.delete("/players/:playerId", requireAuth, async (req, res) => {
  const { userId } = getAuth(req);
  const playerId = parseInt(String(req.params.playerId));
  if (isNaN(playerId)) { res.status(400).json({ error: "Invalid id" }); return; }

  const [existingPlayer] = await db.select().from(playersTable).where(eq(playersTable.id, playerId));
  if (!existingPlayer) { res.status(404).json({ error: "Player not found" }); return; }

  if (!existingPlayer.leagueId || !(await isLeagueAdmin(existingPlayer.leagueId, userId!))) {
    res.status(403).json({ error: "Only this league's admins can delete a player" });
    return;
  }

  const [anyMatch] = await db
    .select({ id: matchesTable.id })
    .from(matchesTable)
    .where(
      or(
        eq(matchesTable.player1Id, playerId),
        eq(matchesTable.player2Id, playerId),
        eq(matchesTable.player3Id, playerId),
        eq(matchesTable.player4Id, playerId),
      )
    )
    .limit(1);
  if (anyMatch) {
    res.status(409).json({
      error: "This player has matches, so they can't be deleted. Remove them from the league in Manage instead.",
      removePath: `/api/leagues/${existingPlayer.leagueId}/players/${playerId}/remove`,
    });
    return;
  }

  await db.delete(playersTable).where(eq(playersTable.id, playerId));
  { res.status(204).send(); return; }
});

// Signed in only, for players the caller can see, counting only matches the
// caller can see (ones they played in, or in leagues they can see).
router.get("/players/:playerId/stats", requireAuth, async (req, res) => {
  const playerId = parseInt(String(req.params.playerId));
  if (isNaN(playerId)) { res.status(400).json({ error: "Invalid id" }); return; }

  const [player] = await db.select().from(playersTable).where(eq(playersTable.id, playerId));
  const scope = await readScope(getAuth(req).userId!, { openLeagues: true });
  if (!player || !canSeePlayer(scope, player)) { res.status(404).json({ error: "Player not found" }); return; }

  const matches = await db
    .select()
    .from(matchesTable)
    .where(
      and(
        eq(matchesTable.status, "completed"),
        scope.matchFilter,
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

  { res.json({
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
  }); return; }
});

export default router;
