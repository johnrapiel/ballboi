import { Router, type Request, type Response } from "express";
import { getAuth } from "@clerk/express";
import { db } from "@workspace/db";
import { matchesTable, playersTable, leaguesTable, leagueRoundsTable, ballBoiSessionsTable } from "@workspace/db";
import { CreateMatchBody, UpdateMatchBody } from "@workspace/api-zod";
import { eq, desc, inArray, and, or, isNull, type SQL } from "drizzle-orm";
import { sendPushToUsers } from "./notifications";
import { isLeagueAdmin } from "../lib/leagueAccess.js";
import { canSeeMatch, readScope } from "../lib/matchAccess.js";
import { getAutoSeason } from "../services/seasonService.js";
import { getPlayerNameMap, getLeagueNameMap, getRoundMap, matchPlayerIds } from "../lib/lookups.js";

const router = Router();

async function buildMatchResponse(m: typeof matchesTable.$inferSelect) {
  const [playerMap, leagueMap, roundMap] = await Promise.all([
    getPlayerNameMap(matchPlayerIds(m)),
    getLeagueNameMap([m.leagueId]),
    getRoundMap([m.roundId]),
  ]);
  const roundNumber = m.roundId ? (roundMap[m.roundId]?.roundNumber ?? null) : null;
  const roundEndDate = m.roundId ? (roundMap[m.roundId]?.endDate ?? null) : null;

  return {
    ...m,
    player1Name: playerMap[m.player1Id] ?? "Unknown",
    player2Name: playerMap[m.player2Id] ?? "Unknown",
    player3Id: m.player3Id ?? null,
    player3Name: m.player3Id ? (playerMap[m.player3Id] ?? "Unknown") : null,
    player4Id: m.player4Id ?? null,
    player4Name: m.player4Id ? (playerMap[m.player4Id] ?? "Unknown") : null,
    leagueName: m.leagueId ? (leagueMap[m.leagueId] ?? null) : null,
    winnerId: m.winnerId ?? null,
    leagueId: m.leagueId ?? null,
    scheduledAt: m.scheduledAt ?? null,
    startedAt: m.startedAt ?? null,
    completedAt: m.completedAt ?? null,
    location: m.location ?? null,
    score: m.score ?? null,
    notes: m.notes ?? null,
    durationMinutes: m.durationMinutes ?? null,
    recordedByClerkUserId: m.recordedByClerkUserId ?? null,
    recordedAt: m.recordedAt ?? null,
    roundId: m.roundId ?? null,
    roundNumber,
    roundEndDate,
    playoffBracketId: m.playoffBracketId ?? null,
    playoffRound: m.playoffRound ?? null,
    playoffSlot: m.playoffSlot ?? null,
    season: m.season ?? null,
    createdAt: m.createdAt.toISOString(),
    updatedAt: m.updatedAt.toISOString(),
  };
}

// Signed in only: matches the caller played in, or in leagues they can see.
router.get("/matches", async (req, res) => {
  const { userId } = getAuth(req);
  if (!userId) return res.status(401).json({ error: "Unauthorized" });
  const scope = await readScope(userId, { openLeagues: true });
  const leagueId = req.query.leagueId ? parseInt(req.query.leagueId as string) : null;
  const playerId = req.query.playerId ? parseInt(req.query.playerId as string) : null;
  const status = (req.query.status as string) ?? null;

  const filters: SQL[] = [scope.matchFilter];
  if (leagueId && !isNaN(leagueId)) filters.push(eq(matchesTable.leagueId, leagueId));
  if (playerId && !isNaN(playerId)) {
    filters.push(
      or(
        eq(matchesTable.player1Id, playerId),
        eq(matchesTable.player2Id, playerId),
        eq(matchesTable.player3Id, playerId),
        eq(matchesTable.player4Id, playerId),
      )!,
    );
  }
  if (status) filters.push(eq(matchesTable.status, status));

  const rows = await db
    .select()
    .from(matchesTable)
    .where(and(...filters))
    .orderBy(desc(matchesTable.createdAt));

  const matchIds = rows.map((m) => m.id);

  const [playerMap, leagueMap, roundMap, allSessions] = await Promise.all([
    getPlayerNameMap(rows.flatMap(matchPlayerIds)),
    getLeagueNameMap(rows.map((m) => m.leagueId)),
    getRoundMap(rows.map((m) => m.roundId)),
    matchIds.length > 0
      ? db.select({ matchId: ballBoiSessionsTable.matchId }).from(ballBoiSessionsTable).where(inArray(ballBoiSessionsTable.matchId, matchIds))
      : Promise.resolve([]),
  ]);
  const ballBoiMatchIds = new Set(allSessions.map((s) => s.matchId));

  return res.json(
    rows.map((m) => ({
      ...m,
      player1Name: playerMap[m.player1Id] ?? "Unknown",
      player2Name: playerMap[m.player2Id] ?? "Unknown",
      player3Id: m.player3Id ?? null,
      player3Name: m.player3Id ? (playerMap[m.player3Id] ?? "Unknown") : null,
      player4Id: m.player4Id ?? null,
      player4Name: m.player4Id ? (playerMap[m.player4Id] ?? "Unknown") : null,
      leagueName: m.leagueId ? (leagueMap[m.leagueId] ?? null) : null,
      winnerId: m.winnerId ?? null,
      leagueId: m.leagueId ?? null,
      scheduledAt: m.scheduledAt ?? null,
      startedAt: m.startedAt ?? null,
      completedAt: m.completedAt ?? null,
      location: m.location ?? null,
      score: m.score ?? null,
      notes: m.notes ?? null,
      durationMinutes: m.durationMinutes ?? null,
      recordedByClerkUserId: m.recordedByClerkUserId ?? null,
      recordedAt: m.recordedAt ?? null,
      roundId: m.roundId ?? null,
      roundNumber: m.roundId ? (roundMap[m.roundId]?.roundNumber ?? null) : null,
      roundEndDate: m.roundId ? (roundMap[m.roundId]?.endDate ?? null) : null,
      playoffBracketId: m.playoffBracketId ?? null,
      playoffRound: m.playoffRound ?? null,
      playoffSlot: m.playoffSlot ?? null,
      hasBallBoi: ballBoiMatchIds.has(m.id),
      createdAt: m.createdAt.toISOString(),
      updatedAt: m.updatedAt.toISOString(),
    }))
  );
});

// C3: the app adds league matches through rounds and quick matches through
// recording, and enters scores through the league score routes. These older
// match routes stay for league admins only, and never touch a result, so the
// league score rules (first score stands, grace week, undo, correction) can't
// be skipped.

const SCORE_ROUTE_ONLY =
  "Scores are entered from the league's score screen, so the league's score rules apply.";

/** Answers 401/403/404 and returns false unless the caller is an admin of `leagueId`. */
async function allowLeagueAdmin(req: Request, res: Response, leagueId: number | null | undefined): Promise<boolean> {
  const { userId } = getAuth(req);
  if (!userId) { res.status(401).json({ error: "Unauthorized" }); return false; }
  if (leagueId == null) {
    res.status(403).json({ error: "Only league admins can change matches here." });
    return false;
  }
  if (!(await isLeagueAdmin(leagueId, userId))) {
    res.status(403).json({ error: "Only this league's admins can change its matches." });
    return false;
  }
  return true;
}

router.post("/matches", async (req, res) => {
  if (!getAuth(req).userId) return res.status(401).json({ error: "Unauthorized" });
  const parsed = CreateMatchBody.safeParse(req.body);
  if (!parsed.success) return res.status(400).json({ error: parsed.error.message });

  const { player1Id, player2Id, player3Id, player4Id, leagueId } = parsed.data;
  if (!(await allowLeagueAdmin(req, res, leagueId))) return;
  if (parsed.data.score != null || parsed.data.winnerId != null) {
    return res.status(400).json({ error: SCORE_ROUTE_ONLY });
  }

  const hasDoublesPartners = player3Id != null || player4Id != null;
  if (hasDoublesPartners) {
    if (player3Id == null || player4Id == null) {
      return res.status(400).json({ error: "Doubles matches require all four players (player3Id and player4Id)" });
    }
    const ids = [player1Id, player2Id, player3Id, player4Id];
    if (new Set(ids).size !== ids.length) {
      return res.status(400).json({ error: "All four players in a doubles match must be distinct" });
    }
  } else {
    if (player1Id === player2Id) {
      return res.status(400).json({ error: "player1Id and player2Id must be different" });
    }
  }

  const [league] = await db.select().from(leaguesTable).where(eq(leaguesTable.id, leagueId!));
  if (!league) return res.status(404).json({ error: "League not found" });
  if (league.endedAt) return res.status(409).json({ error: "This league has ended." });
  const leagueType = league.leagueType ?? "singles";
  if (leagueType === "doubles" && !hasDoublesPartners) {
    return res.status(400).json({ error: "This is a doubles league — provide player3Id and player4Id" });
  }
  if (leagueType === "singles" && hasDoublesPartners) {
    return res.status(400).json({ error: "This is a singles league — do not provide player3Id or player4Id" });
  }

  // Every player must be in this league.
  const wanted = [player1Id, player2Id, player3Id, player4Id].filter((id): id is number => id != null);
  const inLeague = await db
    .select({ id: playersTable.id })
    .from(playersTable)
    .where(and(inArray(playersTable.id, wanted), eq(playersTable.leagueId, leagueId!), isNull(playersTable.leftAt)));
  if (inLeague.length !== wanted.length) {
    return res.status(400).json({ error: "Every player must be in this league." });
  }

  const { score: _score, winnerId: _winnerId, ...fields } = parsed.data;
  const insertData = {
    ...fields,
    status: "scheduled" as const,
    player3Id: parsed.data.player3Id ?? undefined,
    player4Id: parsed.data.player4Id ?? undefined,
    season: (await getAutoSeason(parsed.data.leagueId ?? null)) ?? undefined,
  };
  const [match] = await db.insert(matchesTable).values(insertData).returning();
  const response = await buildMatchResponse(match);

  // Push notifications — fire and forget
  if (match.scheduledAt) {
    const recipients = await db
      .select({ id: playersTable.id, clerkUserId: playersTable.clerkUserId })
      .from(playersTable)
      .where(inArray(playersTable.id, [match.player1Id, match.player2Id]));
    const p1 = recipients.find((p) => p.id === match.player1Id);
    const p2 = recipients.find((p) => p.id === match.player2Id);
    const dateStr = new Date(match.scheduledAt).toLocaleDateString("en-US", { weekday: "short", month: "short", day: "numeric", hour: "2-digit", minute: "2-digit" });
    const clerkIds = [p1?.clerkUserId, p2?.clerkUserId].filter(Boolean) as string[];
    const matchTitle = match.player3Id
      ? `${response.player1Name} & ${response.player3Name} vs ${response.player2Name} & ${response.player4Name}`
      : `${response.player1Name} vs ${response.player2Name}`;
    sendPushToUsers(clerkIds, "Match Scheduled", `${matchTitle} — ${dateStr}`, `/matches/${match.id}`).catch(() => {});
  }

  return res.status(201).json(response);
});

router.get("/matches/:matchId", async (req, res) => {
  const { userId } = getAuth(req);
  if (!userId) return res.status(401).json({ error: "Unauthorized" });
  const matchId = parseInt(req.params.matchId);
  if (isNaN(matchId)) return res.status(400).json({ error: "Invalid id" });
  const [match] = await db.select().from(matchesTable).where(eq(matchesTable.id, matchId));
  // Same answer for a match that doesn't exist and one the caller can't see.
  if (!match || !canSeeMatch(await readScope(userId, { openLeagues: true }), match)) {
    return res.status(404).json({ error: "Match not found" });
  }
  return res.json(await buildMatchResponse(match));
});

router.patch("/matches/:matchId", async (req, res) => {
  const { userId } = getAuth(req);
  if (!userId) return res.status(401).json({ error: "Unauthorized" });

  const matchId = parseInt(req.params.matchId);
  if (isNaN(matchId)) return res.status(400).json({ error: "Invalid id" });
  const parsed = UpdateMatchBody.safeParse(req.body);
  if (!parsed.success) return res.status(400).json({ error: parsed.error.message });

  const [existingMatch] = await db.select().from(matchesTable).where(eq(matchesTable.id, matchId));
  if (!existingMatch) return res.status(404).json({ error: "Match not found" });
  if (!(await allowLeagueAdmin(req, res, existingMatch.leagueId))) return;

  // Results only change through the league score routes (enter, undo, correct).
  const resultFields = ["status", "score", "winnerId", "completedAt", "recordedByClerkUserId", "recordedAt"] as const;
  if (resultFields.some((f) => (parsed.data as Record<string, unknown>)[f] !== undefined)) {
    return res.status(400).json({ error: SCORE_ROUTE_ONLY });
  }

  // The caller's player record in this league names them in notifications.
  const [callerPlayer] = await db
    .select()
    .from(playersTable)
    .where(and(eq(playersTable.clerkUserId, userId), eq(playersTable.leagueId, existingMatch.leagueId!)));

  const updates: Partial<typeof matchesTable.$inferInsert> = {};
  if (parsed.data.scheduledAt !== undefined) updates.scheduledAt = parsed.data.scheduledAt ?? undefined;
  if (parsed.data.startedAt !== undefined) updates.startedAt = parsed.data.startedAt ?? undefined;
  if (parsed.data.location !== undefined) updates.location = parsed.data.location ?? undefined;
  if (parsed.data.notes !== undefined) updates.notes = parsed.data.notes ?? undefined;
  if (parsed.data.durationMinutes !== undefined) updates.durationMinutes = parsed.data.durationMinutes ?? undefined;
  if (Object.keys(updates).length === 0) return res.status(400).json({ error: "Nothing to change." });

  const [match] = await db.update(matchesTable).set(updates).where(eq(matchesTable.id, matchId)).returning();

  // Notify opponents when scheduledAt or location is changed on an already-scheduled match
  const scheduledAtChanged =
    existingMatch.scheduledAt != null &&
    updates.scheduledAt != null &&
    new Date(existingMatch.scheduledAt).getTime() !== new Date(updates.scheduledAt as string).getTime();
  const locationChanged =
    updates.location !== undefined &&
    (updates.location ?? null) !== (existingMatch.location ?? null);

  if (scheduledAtChanged || (existingMatch.scheduledAt != null && locationChanged)) {
    const allParticipantIds = [
      existingMatch.player1Id,
      existingMatch.player2Id,
      existingMatch.player3Id,
      existingMatch.player4Id,
    ].filter((id): id is number => id != null);

    const allParticipantPlayers = await db
      .select()
      .from(playersTable)
      .where(inArray(playersTable.id, allParticipantIds));

    const updaterName = callerPlayer?.name ?? "Your league admin";

    // Build a message that describes what changed
    const effectiveScheduledAt = scheduledAtChanged
      ? (updates.scheduledAt as string)
      : existingMatch.scheduledAt!;
    const dateStr = new Date(effectiveScheduledAt).toLocaleString("en-US", {
      weekday: "short",
      month: "short",
      day: "numeric",
      hour: "numeric",
      minute: "2-digit",
      timeZone: "UTC",
    });

    let changeDescription: string;
    if (scheduledAtChanged && locationChanged) {
      const newLocation = updates.location ?? null;
      changeDescription = newLocation
        ? `Match rescheduled by ${updaterName} — ${dateStr} at ${newLocation}`
        : `Match rescheduled by ${updaterName} — ${dateStr}`;
    } else if (scheduledAtChanged) {
      changeDescription = `Match rescheduled by ${updaterName} — ${dateStr}`;
    } else {
      const newLocation = updates.location ?? null;
      changeDescription = newLocation
        ? `Match location updated by ${updaterName} — ${newLocation} (${dateStr})`
        : `Match location removed by ${updaterName} (${dateStr})`;
    }

    for (const participant of allParticipantPlayers) {
      if (!participant || !participant.clerkUserId) continue;
      if (participant.clerkUserId === userId) continue;

      sendPushToUsers(
        [participant.clerkUserId],
        "Match Updated",
        changeDescription,
        `/matches/${existingMatch.id}`
      ).catch(() => {});
    }
  }

  // Notify opponents when scheduledAt is set for the first time (null → value)
  if (existingMatch.scheduledAt == null && updates.scheduledAt != null) {
    const allParticipantIds = [
      existingMatch.player1Id,
      existingMatch.player2Id,
      existingMatch.player3Id,
      existingMatch.player4Id,
    ].filter((id): id is number => id != null);

    const allParticipantPlayers = await db
      .select()
      .from(playersTable)
      .where(inArray(playersTable.id, allParticipantIds));

    // The setter's player record (may be null if not linked)
    const setterPlayer = callerPlayer;

    // Determine round label
    let roundLabel = "";
    if (existingMatch.roundId) {
      const [round] = await db
        .select({ roundNumber: leagueRoundsTable.roundNumber })
        .from(leagueRoundsTable)
        .where(eq(leagueRoundsTable.id, existingMatch.roundId));
      if (round) roundLabel = `Round ${round.roundNumber} `;
    }

    // Format the scheduled date/time
    const scheduledDate = new Date(updates.scheduledAt as string);
    const dateStr = scheduledDate.toLocaleString("en-US", {
      weekday: "short",
      month: "short",
      day: "numeric",
      hour: "numeric",
      minute: "2-digit",
      timeZone: "UTC",
    });

    // Notify each participant who is NOT the caller
    for (const participant of allParticipantPlayers) {
      if (!participant || !participant.clerkUserId) continue;
      if (participant.clerkUserId === userId) continue;

      // Find the opponent name(s) from the setter's perspective relative to this participant
      const opponentName = setterPlayer?.name ?? "Your opponent";

      sendPushToUsers(
        [participant.clerkUserId],
        `${roundLabel}Match Scheduled`,
        `Your ${roundLabel}match is scheduled — ${dateStr} vs ${opponentName}`,
        `/matches/${existingMatch.id}`
      ).catch(() => {});
    }
  }

  return res.json(await buildMatchResponse(match));
});

router.delete("/matches/:matchId", async (req, res) => {
  if (!getAuth(req).userId) return res.status(401).json({ error: "Unauthorized" });
  const matchId = parseInt(req.params.matchId);
  if (isNaN(matchId)) return res.status(400).json({ error: "Invalid id" });
  const [match] = await db.select().from(matchesTable).where(eq(matchesTable.id, matchId));
  if (!match) return res.status(404).json({ error: "Match not found" });
  if (!(await allowLeagueAdmin(req, res, match.leagueId))) return;
  // A played match stays: its score is corrected from Manage, never deleted.
  if (match.status === "completed") {
    return res.status(409).json({ error: "This match has a score. Correct it from Manage instead." });
  }
  if (match.playoffBracketId) {
    return res.status(409).json({ error: "Playoff matches can't be deleted." });
  }
  await db.delete(matchesTable).where(eq(matchesTable.id, matchId));
  return res.status(204).send();
});

export default router;
