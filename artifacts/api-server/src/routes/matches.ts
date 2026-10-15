import { Router } from "express";
import { getAuth } from "@clerk/express";
import { db } from "@workspace/db";
import { matchesTable, playersTable, leaguesTable, leagueRoundsTable, ballBoiSessionsTable } from "@workspace/db";
import { CreateMatchBody, UpdateMatchBody } from "@workspace/api-zod";
import { eq, desc, inArray } from "drizzle-orm";
import { sendPushToUsers } from "./notifications";
import { advancePlayoffWinner } from "../services/playoffBracket";
import { logger } from "../lib/logger";
import { getAutoSeason } from "../services/seasonService.js";
import { parseSet } from "../lib/scoringUtils.js";

const router = Router();

function validateScoreFormat(score: string): string | null {
  const trimmed = score.trim();
  if (!trimmed) return null;
  const sets = trimmed.split(",");
  for (const set of sets) {
    if (!parseSet(set)) {
      return `"${set.trim()}" is not a valid set score. Use a format like 6-4 for each set.`;
    }
  }
  return null;
}

async function buildMatchResponse(m: typeof matchesTable.$inferSelect) {
  const allPlayers = await db.select().from(playersTable);
  const allLeagues = await db.select().from(leaguesTable);
  const playerMap: Record<number, string> = {};
  for (const p of allPlayers) playerMap[p.id] = p.name;
  const leagueMap: Record<number, string> = {};
  for (const l of allLeagues) leagueMap[l.id] = l.name;

  let roundNumber: number | null = null;
  let roundEndDate: string | null = null;
  if (m.roundId) {
    const [round] = await db.select({ roundNumber: leagueRoundsTable.roundNumber, endDate: leagueRoundsTable.endDate })
      .from(leagueRoundsTable)
      .where(eq(leagueRoundsTable.id, m.roundId));
    roundNumber = round?.roundNumber ?? null;
    roundEndDate = round?.endDate ?? null;
  }

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

router.get("/matches", async (req, res) => {
  const leagueId = req.query.leagueId ? parseInt(req.query.leagueId as string) : null;
  const playerId = req.query.playerId ? parseInt(req.query.playerId as string) : null;
  const status = (req.query.status as string) ?? null;

  let rows = await db.select().from(matchesTable).orderBy(desc(matchesTable.createdAt));

  if (leagueId && !isNaN(leagueId)) rows = rows.filter((m) => m.leagueId === leagueId);
  if (playerId && !isNaN(playerId)) rows = rows.filter((m) => m.player1Id === playerId || m.player2Id === playerId || m.player3Id === playerId || m.player4Id === playerId);
  if (status) rows = rows.filter((m) => m.status === status);

  const matchIds = rows.map((m) => m.id);

  const [allPlayers, allLeagues, allRounds, allSessions] = await Promise.all([
    db.select().from(playersTable),
    db.select().from(leaguesTable),
    db.select({ id: leagueRoundsTable.id, roundNumber: leagueRoundsTable.roundNumber, endDate: leagueRoundsTable.endDate }).from(leagueRoundsTable),
    matchIds.length > 0
      ? db.select({ matchId: ballBoiSessionsTable.matchId }).from(ballBoiSessionsTable).where(inArray(ballBoiSessionsTable.matchId, matchIds))
      : Promise.resolve([]),
  ]);
  const playerMap: Record<number, string> = {};
  for (const p of allPlayers) playerMap[p.id] = p.name;
  const leagueMap: Record<number, string> = {};
  for (const l of allLeagues) leagueMap[l.id] = l.name;
  const roundMap: Record<number, { roundNumber: number; endDate: string }> = {};
  for (const r of allRounds) roundMap[r.id] = { roundNumber: r.roundNumber, endDate: r.endDate };
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

router.post("/matches", async (req, res) => {
  const parsed = CreateMatchBody.safeParse(req.body);
  if (!parsed.success) return res.status(400).json({ error: parsed.error.message });

  const { player1Id, player2Id, player3Id, player4Id, leagueId } = parsed.data;
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

  if (leagueId) {
    const [league] = await db.select().from(leaguesTable).where(eq(leaguesTable.id, leagueId));
    if (league) {
      const leagueType = league.leagueType ?? "singles";
      if (leagueType === "doubles" && !hasDoublesPartners) {
        return res.status(400).json({ error: "This is a doubles league — provide player3Id and player4Id" });
      }
      if (leagueType === "singles" && hasDoublesPartners) {
        return res.status(400).json({ error: "This is a singles league — do not provide player3Id or player4Id" });
      }
    }
  }

  // Validate score format when provided
  if (parsed.data.score) {
    const scoreFormatError = validateScoreFormat(parsed.data.score);
    if (scoreFormatError) return res.status(400).json({ error: scoreFormatError });
  }

  // Validate winnerId is a match participant when provided
  if (parsed.data.winnerId != null) {
    const participantIds = [player1Id, player2Id, player3Id, player4Id].filter(
      (id): id is number => id != null
    );
    if (!participantIds.includes(parsed.data.winnerId)) {
      return res.status(400).json({ error: "winnerId must be one of the match participants" });
    }
  }

  // Validate winner/score consistency when both are provided
  // Score is from player1's perspective: first number = player1 games, second = player2 games.
  if (parsed.data.score && parsed.data.winnerId != null) {
    const sets = parsed.data.score.trim().split(",");
    let p1Sets = 0;
    let p2Sets = 0;
    for (const set of sets) {
      const setScore = parseSet(set);
      if (setScore) {
        const { myGames: p1Games, oppGames: p2Games } = setScore;
        if (p1Games > p2Games) p1Sets++;
        else if (p2Games > p1Games) p2Sets++;
      }
    }
    if (p1Sets === p2Sets) {
      return res.status(400).json({
        error:
          "The set scores are tied. If a match tiebreak was played, include it in the score (e.g. 10-7). Otherwise, check the score.",
      });
    }
    const scoreImpliesPlayer1Wins = p1Sets > p2Sets;
    const sentWinnerIsPlayer1 =
      parsed.data.winnerId === player1Id ||
      parsed.data.winnerId === player3Id;
    if (scoreImpliesPlayer1Wins !== sentWinnerIsPlayer1) {
      return res.status(400).json({
        error: "The score provided is inconsistent with the selected winner.",
      });
    }
  }

  const hasScore = !!(parsed.data.score && parsed.data.winnerId != null);
  const insertData = {
    ...parsed.data,
    status: (hasScore ? "completed" : "scheduled") as "completed" | "scheduled",
    player3Id: parsed.data.player3Id ?? undefined,
    player4Id: parsed.data.player4Id ?? undefined,
    winnerId: parsed.data.winnerId ?? undefined,
    score: parsed.data.score ?? undefined,
    completedAt: hasScore ? new Date().toISOString() : undefined,
    season: (await getAutoSeason(parsed.data.leagueId ?? null)) ?? undefined,
  };
  const [match] = await db.insert(matchesTable).values(insertData).returning();
  const response = await buildMatchResponse(match);

  // Push notifications — fire and forget
  if (match.scheduledAt) {
    const [p1] = await db.select().from(playersTable).where(eq(playersTable.id, match.player1Id));
    const [p2] = await db.select().from(playersTable).where(eq(playersTable.id, match.player2Id));
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
  const matchId = parseInt(req.params.matchId);
  if (isNaN(matchId)) return res.status(400).json({ error: "Invalid id" });
  const [match] = await db.select().from(matchesTable).where(eq(matchesTable.id, matchId));
  if (!match) return res.status(404).json({ error: "Match not found" });
  return res.json(await buildMatchResponse(match));
});

router.patch("/matches/:matchId", async (req, res) => {
  // Require authentication
  const { userId } = getAuth(req);
  if (!userId) return res.status(401).json({ error: "Unauthorized" });

  const matchId = parseInt(req.params.matchId);
  if (isNaN(matchId)) return res.status(400).json({ error: "Invalid id" });
  const parsed = UpdateMatchBody.safeParse(req.body);
  if (!parsed.success) return res.status(400).json({ error: parsed.error.message });

  const [existingMatch] = await db.select().from(matchesTable).where(eq(matchesTable.id, matchId));
  if (!existingMatch) return res.status(404).json({ error: "Match not found" });

  // Validate score format when provided
  if (parsed.data.score) {
    const scoreFormatError = validateScoreFormat(parsed.data.score);
    if (scoreFormatError) return res.status(400).json({ error: scoreFormatError });
  }

  // Validate winnerId is a match participant when provided
  if (parsed.data.winnerId != null) {
    const participantIds = [
      existingMatch.player1Id,
      existingMatch.player2Id,
      existingMatch.player3Id,
      existingMatch.player4Id,
    ].filter((id): id is number => id != null);
    if (!participantIds.includes(parsed.data.winnerId)) {
      return res.status(400).json({ error: "winnerId must be one of the match participants" });
    }
  }

  // Look up the caller's player record for score-perspective validation below.
  const callerPlayers = await db.select().from(playersTable).where(eq(playersTable.clerkUserId, userId));
  const callerPlayer = callerPlayers[0] ?? null;

  const participantIds = [
    existingMatch.player1Id,
    existingMatch.player2Id,
    existingMatch.player3Id,
    existingMatch.player4Id,
  ].filter((id): id is number => id != null);

  const isParticipant = callerPlayer != null && participantIds.includes(callerPlayer.id);

  // Block re-submission when the match is already completed, unless the caller
  // is a participant correcting their own score.
  if (parsed.data.status === "completed" && existingMatch.status === "completed" && !isParticipant) {
    return res.status(409).json({
      error: "This match result has already been recorded. Refresh the page to see the latest result.",
    });
  }

  // Winner/score consistency check.
  // The UI always sends scores from player1's perspective: first number = player1 games, second = player2 games.
  if (parsed.data.score && parsed.data.winnerId != null) {
    const sets = parsed.data.score.trim().split(",");
    let p1Sets = 0;
    let p2Sets = 0;
    for (const set of sets) {
      const setScore = parseSet(set);
      if (setScore) {
        const { myGames: p1Games, oppGames: p2Games } = setScore;
        if (p1Games > p2Games) p1Sets++;
        else if (p2Games > p1Games) p2Sets++;
      }
    }
    if (p1Sets === p2Sets) {
      return res.status(400).json({
        error:
          "The set scores are tied. If a match tiebreak was played, include it in the score (e.g. 10-7). Otherwise, check the score.",
      });
    }
    const scoreImpliesPlayer1Wins = p1Sets > p2Sets;
    const sentWinnerIsPlayer1 =
      parsed.data.winnerId === existingMatch.player1Id ||
      parsed.data.winnerId === existingMatch.player3Id;
    if (scoreImpliesPlayer1Wins !== sentWinnerIsPlayer1) {
      return res.status(400).json({
        error: "The score provided is inconsistent with the selected winner.",
      });
    }
  }

  const updates: Partial<typeof matchesTable.$inferInsert> = {};
  if (parsed.data.status !== undefined && parsed.data.status !== null) updates.status = parsed.data.status;
  if (parsed.data.winnerId !== undefined) updates.winnerId = parsed.data.winnerId ?? undefined;
  if (parsed.data.score !== undefined) updates.score = parsed.data.score ?? undefined;
  if (parsed.data.scheduledAt !== undefined) updates.scheduledAt = parsed.data.scheduledAt ?? undefined;
  if (parsed.data.startedAt !== undefined) updates.startedAt = parsed.data.startedAt ?? undefined;
  if (parsed.data.completedAt !== undefined) updates.completedAt = parsed.data.completedAt ?? undefined;
  if (parsed.data.location !== undefined) updates.location = parsed.data.location ?? undefined;
  if (parsed.data.notes !== undefined) updates.notes = parsed.data.notes ?? undefined;
  if (parsed.data.durationMinutes !== undefined) updates.durationMinutes = parsed.data.durationMinutes ?? undefined;
  if ("recordedByClerkUserId" in parsed.data && parsed.data.recordedByClerkUserId !== undefined) {
    updates.recordedByClerkUserId = parsed.data.recordedByClerkUserId ?? undefined;
  }
  if ("recordedAt" in parsed.data && parsed.data.recordedAt !== undefined) {
    updates.recordedAt = parsed.data.recordedAt ?? undefined;
  }

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

    const allParticipantPlayers = await Promise.all(
      allParticipantIds.map((id) =>
        db.select().from(playersTable).where(eq(playersTable.id, id)).then((rows) => rows[0] ?? null)
      )
    );

    const updaterName = callerPlayer?.name ?? "Your opponent";

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

    const allParticipantPlayers = await Promise.all(
      allParticipantIds.map((id) =>
        db.select().from(playersTable).where(eq(playersTable.id, id)).then((rows) => rows[0] ?? null)
      )
    );

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

  if (
    updates.status === "completed" &&
    updates.winnerId &&
    existingMatch.status !== "completed"
  ) {
    const winnerId = updates.winnerId;
    const isDoubles = existingMatch.player3Id !== null && existingMatch.player3Id !== undefined;

    if (isDoubles) {
      // Doubles: Team 1 = player1+player3, Team 2 = player2+player4
      const team1Won = winnerId === existingMatch.player1Id;
      const winnerIds = team1Won
        ? [existingMatch.player1Id, existingMatch.player3Id!]
        : [existingMatch.player2Id, existingMatch.player4Id!];
      const loserIds = team1Won
        ? [existingMatch.player2Id, ...(existingMatch.player4Id ? [existingMatch.player4Id] : [])]
        : [existingMatch.player1Id, ...(existingMatch.player3Id ? [existingMatch.player3Id] : [])];

      for (const id of winnerIds) {
        const [p] = await db.select().from(playersTable).where(eq(playersTable.id, id));
        if (p) await db.update(playersTable).set({ wins: p.wins + 1 }).where(eq(playersTable.id, id));
      }
      for (const id of loserIds) {
        const [p] = await db.select().from(playersTable).where(eq(playersTable.id, id));
        if (p) await db.update(playersTable).set({ losses: p.losses + 1 }).where(eq(playersTable.id, id));
      }

      const allPlayers = await db.select().from(playersTable);
      const pMap: Record<number, typeof allPlayers[0]> = {};
      for (const p of allPlayers) pMap[p.id] = p;
      const clerkIds = [...winnerIds, ...loserIds].map((id) => pMap[id]?.clerkUserId).filter(Boolean) as string[];
      const winTeamNames = winnerIds.map((id) => pMap[id]?.name ?? "Unknown").join(" & ");
      const loseTeamNames = loserIds.map((id) => pMap[id]?.name ?? "Unknown").join(" & ");
      const scoreStr = updates.score ?? "";
      const body = scoreStr
        ? `${winTeamNames} defeats ${loseTeamNames} (${scoreStr})`
        : `${winTeamNames} defeats ${loseTeamNames}`;
      sendPushToUsers(clerkIds, "Match Result", body, `/matches/${existingMatch.id}`).catch(() => {});
    } else {
      // Singles
      const loserId = existingMatch.player1Id === winnerId ? existingMatch.player2Id : existingMatch.player1Id;
      const [winnerPlayer] = await db.select().from(playersTable).where(eq(playersTable.id, winnerId));
      const [loserPlayer] = await db.select().from(playersTable).where(eq(playersTable.id, loserId));
      if (winnerPlayer) {
        await db.update(playersTable).set({ wins: winnerPlayer.wins + 1 }).where(eq(playersTable.id, winnerId));
      }
      if (loserPlayer) {
        await db.update(playersTable).set({ losses: loserPlayer.losses + 1 }).where(eq(playersTable.id, loserId));
      }

      const scoreStr = updates.score ?? "";
      const winnerName = winnerPlayer?.name ?? "Unknown";
      const loserName = loserPlayer?.name ?? "Unknown";
      const clerkIds = [winnerPlayer?.clerkUserId, loserPlayer?.clerkUserId].filter(Boolean) as string[];
      const body = scoreStr
        ? `${winnerName} defeats ${loserName} (${scoreStr})`
        : `${winnerName} defeats ${loserName}`;
      sendPushToUsers(clerkIds, "Match Result", body, `/matches/${existingMatch.id}`).catch(() => {});
    }

    if (match.playoffBracketId) {
      advancePlayoffWinner(match, winnerId).catch((err) => {
        logger.error({ err, matchId: match.id }, "Failed to advance playoff winner");
      });
    }
  }

  return res.json(await buildMatchResponse(match));
});

router.delete("/matches/:matchId", async (req, res) => {
  const matchId = parseInt(req.params.matchId);
  if (isNaN(matchId)) return res.status(400).json({ error: "Invalid id" });
  await db.delete(matchesTable).where(eq(matchesTable.id, matchId));
  return res.status(204).send();
});

export default router;
