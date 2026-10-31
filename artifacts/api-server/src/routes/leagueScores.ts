import { Router } from "express";
import { getAuth } from "@clerk/express";
import { db, leagueRoundsTable, leaguesTable, matchesTable, playersTable } from "@workspace/db";
import { and, eq, inArray, isNull, ne, sql } from "drizzle-orm";
import { leagueToday } from "../lib/leagueCalendar.js";
import {
  checkScoreEntry,
  matchParticipantIds,
  parseMatchScore,
  scoreFromSide,
  winnerIdFor,
} from "../lib/leagueScoring.js";
import { advancePlayoffWinner } from "../services/playoffBracket.js";
import { advancePlayoff } from "../services/leaguePlayoffs.js";
import { usesWeeklyRounds } from "../services/leagueRounds.js";
import { sendPushToUsers } from "./notifications.js";
import { logger } from "../lib/logger.js";

// Enter a league score (spec: Leagues > Scores and standings). Either player
// enters it, from their own side ("6-3, 6-4" means they won both sets). The
// first score entered stands.

const router = Router();

router.post("/leagues/:leagueId/matches/:matchId/score", async (req, res) => {
  const { userId } = getAuth(req);
  if (!userId) { res.status(401).json({ error: "Unauthorized" }); return; }
  const leagueId = parseInt(String(req.params.leagueId));
  const matchId = parseInt(String(req.params.matchId));
  if (isNaN(leagueId) || isNaN(matchId)) { res.status(400).json({ error: "Invalid id" }); return; }
  if (typeof req.body?.score !== "string") { res.status(400).json({ error: "Enter the score for each set, like 6-4." }); return; }

  const [match] = await db
    .select()
    .from(matchesTable)
    .where(and(eq(matchesTable.id, matchId), eq(matchesTable.leagueId, leagueId)));
  if (!match) { res.status(404).json({ error: "Match not found" }); return; }

  const [[round], callerPlayers] = await Promise.all([
    match.roundId
      ? db.select().from(leagueRoundsTable).where(eq(leagueRoundsTable.id, match.roundId))
      : Promise.resolve([]),
    db
      .select({ id: playersTable.id, name: playersTable.name })
      .from(playersTable)
      .where(and(eq(playersTable.leagueId, leagueId), eq(playersTable.clerkUserId, userId), isNull(playersTable.leftAt))),
  ]);

  const check = checkScoreEntry({
    match,
    round: round ?? null,
    today: leagueToday(),
    callerPlayerIds: callerPlayers.map((p) => p.id),
  });
  if (!check.ok) { res.status(check.status).json({ error: check.error }); return; }

  const parsed = parseMatchScore(req.body.score);
  if (!parsed.ok) { res.status(400).json({ error: parsed.error }); return; }

  // The caller typed their own games first. Store it from player 1's side.
  const caller = callerPlayers.find((p) => matchParticipantIds(match).includes(p.id))!;
  const callerSide: 1 | 2 = caller.id === match.player1Id || caller.id === match.player3Id ? 1 : 2;
  const winnerSide: 1 | 2 = callerSide === 1 ? parsed.winnerSide : parsed.winnerSide === 1 ? 2 : 1;
  const storedScore = scoreFromSide(parsed.score, callerSide);
  const winnerId = winnerIdFor(match, winnerSide);
  const now = new Date().toISOString();

  // Only the first score lands: the update is skipped if one is already in.
  const [saved] = await db
    .update(matchesTable)
    .set({
      status: "completed",
      score: storedScore,
      winnerId,
      completedAt: now,
      recordedAt: now,
      recordedByClerkUserId: userId,
      inGrace: check.inGrace,
    })
    .where(and(eq(matchesTable.id, matchId), ne(matchesTable.status, "completed"), isNull(matchesTable.voidedAt)))
    .returning();
  if (!saved) {
    res.status(409).json({ error: "A score is already in for this match. The first score entered stands." });
    return;
  }

  // League record on the player rows counts standings matches only.
  const team1 = [match.player1Id, match.player3Id].filter((id): id is number => id != null);
  const team2 = [match.player2Id, match.player4Id].filter((id): id is number => id != null);
  const [winners, losers] = winnerSide === 1 ? [team1, team2] : [team2, team1];
  if (!check.inGrace && !match.playoffBracketId) {
    await db.transaction(async (tx) => {
      await tx.update(playersTable).set({ wins: sql`${playersTable.wins} + 1` }).where(inArray(playersTable.id, winners));
      await tx.update(playersTable).set({ losses: sql`${playersTable.losses} + 1` }).where(inArray(playersTable.id, losers));
    });
  }
  if (match.playoffBracketId) {
    const [league] = await db.select().from(leaguesTable).where(eq(leaguesTable.id, leagueId));
    const advance = league && usesWeeklyRounds(league) ? advancePlayoff : advancePlayoffWinner;
    await advance(saved, winnerId).catch((err) => logger.error({ err, matchId }, "Couldn't advance playoff winner"));
  }

  // Let everyone else in the match know, each from their own side.
  const others = matchParticipantIds(match).filter((id) => id !== caller.id);
  if (others.length) {
    db.select({ id: playersTable.id, clerkUserId: playersTable.clerkUserId })
      .from(playersTable)
      .where(inArray(playersTable.id, others))
      .then((rows) =>
        Promise.all(
          rows
            .filter((r) => r.clerkUserId && r.clerkUserId !== userId)
            .map((r) => {
              const side: 1 | 2 = team1.includes(r.id) ? 1 : 2;
              return sendPushToUsers(
                [r.clerkUserId!],
                "Score entered",
                `${caller.name} entered ${scoreFromSide(storedScore, side)} for your match.`,
                `/league/${leagueId}`,
              ).catch(() => {});
            }),
        ),
      )
      .catch((err) => logger.error({ err, matchId }, "Couldn't send score notifications"));
  }

  res.status(201).json({
    matchId: saved.id,
    status: saved.status,
    score: saved.score,
    winnerId: saved.winnerId,
    inGrace: saved.inGrace,
    countsForStandings: !saved.inGrace && !saved.playoffBracketId,
  });
});

export default router;
