import { Router } from "express";
import { getAuth } from "@clerk/express";
import { db, leagueRoundsTable, leaguesTable, matchesTable, playersTable, usersTable } from "@workspace/db";
import { and, eq, inArray, isNull, ne, sql } from "drizzle-orm";
import { todayFor } from "../lib/leagueCalendar.js";
import {
  checkScoreEntry,
  matchParticipantIds,
  parseMatchScore,
  scoreFromSide,
  winnerIdFor,
} from "../lib/leagueScoring.js";
import { checkCorrection, checkEdit, recordChanges } from "../lib/leagueScoreChanges.js";
import { leagueHasEnded } from "../lib/leagueLifecycle.js";
import { advanceTo, nextRound, settleProblem, type PlayoffRound } from "../lib/playoffs.js";
import { requireLeagueAdmin } from "../middlewares/requireLeagueAdmin.js";
import { advancePlayoffWinner } from "../services/playoffBracket.js";
import { advancePlayoff, playoffPlayBy, walkover } from "../services/leaguePlayoffs.js";
import { usesWeeklyRounds } from "../services/leagueRounds.js";
import { sendPushToUsers } from "./notifications.js";
import { logger } from "../lib/logger.js";
import { awardMilestonesForMatch } from "../lib/milestoneRepo.js";
import { leagueChat } from "../messaging/leagueChatEvents.js";

// Enter a league score (spec: Leagues > Scores and standings). Either player
// enters it, from their own side ("6-3, 6-4" means they won both sets).
// Either player can edit it for 24 hours after it's entered; the latest edit
// stands. After that it locks, and only a league admin can correct it from
// Manage (finding 7, Nov 6; C5).
// Only real tennis scores save (C10). "Opponent retired" saves the sets so
// far as a win for the player entering it, shown as RET (Q6). Once a league
// ends, its scores are final (Q9).

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

  const retired = req.body?.retired === true;

  // An ended league's standings are frozen (decision 31).
  const [owner] = await db.select().from(leaguesTable).where(eq(leaguesTable.id, leagueId));
  if (owner?.endedAt) { res.status(409).json({ error: "This league has ended, so scores can't be entered." }); return; }

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
    today: todayFor(owner),
    callerPlayerIds: callerPlayers.map((p) => p.id),
    playoffPlayBy: owner && match.playoffBracketId ? await playoffPlayBy(owner, match) : null,
  });
  if (!check.ok) { res.status(check.status).json({ error: check.error }); return; }

  // With "Opponent retired", the caller's side wins (Q6).
  const parsed = parseMatchScore(req.body.score, { retired });
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
      scoreClearedAt: null,
      scoreClearedByName: null,
      scoreEditedAt: null,
      scoreEditedByClerkUserId: null,
      scoreEditedByName: null,
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
    const advance = owner && usesWeeklyRounds(owner) ? advancePlayoff : advancePlayoffWinner;
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

  // Milestones this result earned (decision 149), before the app asks for them.
  await awardMilestonesForMatch(matchId);
  // The result in the league chat, then any standings moves (decision 145).
  leagueChat.resultEntered(leagueId, saved.id);

  res.status(201).json({
    matchId: saved.id,
    status: saved.status,
    score: saved.score,
    winnerId: saved.winnerId,
    inGrace: saved.inGrace,
    countsForStandings: !saved.inGrace && !saved.playoffBracketId,
  });
});

type MatchRow = typeof matchesTable.$inferSelect;

function teams(match: MatchRow) {
  return {
    team1: [match.player1Id, match.player3Id].filter((id): id is number => id != null),
    team2: [match.player2Id, match.player4Id].filter((id): id is number => id != null),
  };
}

function winnerSideOf(match: Pick<MatchRow, "winnerId" | "player1Id" | "player3Id">): 1 | 2 | null {
  if (match.winnerId == null) return null;
  return match.winnerId === match.player1Id || match.winnerId === match.player3Id ? 1 : 2;
}

/** Move each player's league record when a counted result changes. */
async function applyRecordChanges(match: MatchRow, before: 1 | 2 | null, after: 1 | 2 | null) {
  const { team1, team2 } = teams(match);
  const changes = recordChanges(team1, team2, before, after);
  if (!changes.length) return;
  await db.transaction(async (tx) => {
    for (const c of changes) {
      await tx
        .update(playersTable)
        .set({
          wins: sql`GREATEST(0, ${playersTable.wins} + ${c.wins})`,
          losses: sql`GREATEST(0, ${playersTable.losses} + ${c.losses})`,
        })
        .where(eq(playersTable.id, c.playerId));
    }
  });
}

/** The next-round playoff match this one's winner plays in, if it exists. */
async function nextPlayoffMatch(match: MatchRow): Promise<{ id: number; status: string } | null> {
  if (!match.playoffBracketId || !match.playoffRound || !match.playoffSlot) return null;
  const next = nextRound(match.playoffRound as PlayoffRound);
  if (!next) return null;
  const [row] = await db
    .select({ id: matchesTable.id, status: matchesTable.status })
    .from(matchesTable)
    .where(and(
      eq(matchesTable.playoffBracketId, match.playoffBracketId),
      eq(matchesTable.playoffRound, next),
      eq(matchesTable.playoffSlot, advanceTo(match.playoffSlot).slot),
      isNull(matchesTable.voidedAt),
    ));
  return row ?? null;
}

/**
 * Finding 7: either player edits the score, from their own side, for 24
 * hours after it was entered. The latest edit stands, standings recompute,
 * and the other player is told "Score edited by {name}".
 */
router.post("/leagues/:leagueId/matches/:matchId/score/edit", async (req, res) => {
  const { userId } = getAuth(req);
  if (!userId) { res.status(401).json({ error: "Unauthorized" }); return; }
  const leagueId = parseInt(String(req.params.leagueId));
  const matchId = parseInt(String(req.params.matchId));
  if (isNaN(leagueId) || isNaN(matchId)) { res.status(400).json({ error: "Invalid id" }); return; }
  if (typeof req.body?.score !== "string") { res.status(400).json({ error: "Enter the score for each set, like 6-4." }); return; }

  const [[match], [league]] = await Promise.all([
    db.select().from(matchesTable).where(and(eq(matchesTable.id, matchId), eq(matchesTable.leagueId, leagueId))),
    db.select({ endedAt: leaguesTable.endedAt, status: leaguesTable.status }).from(leaguesTable).where(eq(leaguesTable.id, leagueId)),
  ]);
  if (!match) { res.status(404).json({ error: "Match not found" }); return; }

  const playerRows = await db
    .select({ id: playersTable.id, name: playersTable.name, clerkUserId: playersTable.clerkUserId })
    .from(playersTable)
    .where(inArray(playersTable.id, matchParticipantIds(match)));
  const accounts = playerRows.map((p) => p.clerkUserId).filter((id): id is string => !!id);
  const feeds = await nextPlayoffMatch(match);
  const check = checkEdit(match, userId, accounts, new Date(), { leagueEnded: leagueHasEnded(league), next: feeds });
  if (!check.ok) { res.status(check.status).json({ error: check.error }); return; }

  const parsed = parseMatchScore(req.body.score, { retired: req.body?.retired === true });
  if (!parsed.ok) { res.status(400).json({ error: parsed.error }); return; }
  const caller = playerRows.find((p) => p.clerkUserId === userId)!;
  const callerSide: 1 | 2 = caller.id === match.player1Id || caller.id === match.player3Id ? 1 : 2;
  const winnerSide: 1 | 2 = callerSide === 1 ? parsed.winnerSide : parsed.winnerSide === 1 ? 2 : 1;
  const storedScore = scoreFromSide(parsed.score, callerSide);
  const winnerId = winnerIdFor(match, winnerSide);

  // Only lands on the score as the caller saw it, so two edits at once can't
  // both move standings. The first-entered time stays, so the 24 hours don't restart.
  const [saved] = await db
    .update(matchesTable)
    .set({ score: storedScore, winnerId, scoreEditedAt: new Date(), scoreEditedByClerkUserId: userId, scoreEditedByName: caller.name })
    .where(and(
      eq(matchesTable.id, matchId),
      eq(matchesTable.status, "completed"),
      eq(matchesTable.score, match.score!),
      isNull(matchesTable.correctedAt),
      isNull(matchesTable.voidedAt),
    ))
    .returning();
  if (!saved) { res.status(409).json({ error: "This score changed. Pull down to see the latest." }); return; }

  if (match.playoffBracketId) {
    // The edited winner takes the spot in the next round.
    if (feeds && match.winnerId !== winnerId && match.playoffSlot) {
      const position = advanceTo(match.playoffSlot).position;
      await db.update(matchesTable).set(position === 1 ? { player1Id: winnerId } : { player2Id: winnerId }).where(eq(matchesTable.id, feeds.id));
    }
  } else if (!match.inGrace) {
    await applyRecordChanges(match, winnerSideOf(match), winnerSide);
  }

  // Tell everyone else in the match, each from their own side.
  const { team1 } = teams(match);
  Promise.all(
    playerRows
      .filter((r) => r.clerkUserId && r.clerkUserId !== userId)
      .map((r) =>
        sendPushToUsers(
          [r.clerkUserId!],
          "Score edited",
          `Score edited by ${caller.name}: ${scoreFromSide(storedScore, team1.includes(r.id) ? 1 : 2)}.`,
          `/match/${matchId}`,
        ).catch(() => {}),
      ),
  ).catch((err) => logger.error({ err, matchId }, "Couldn't send score edit notifications"));

  await awardMilestonesForMatch(matchId);
  leagueChat.resultEntered(leagueId, saved.id, { edited: true });
  res.json({
    matchId: saved.id,
    score: saved.score!,
    winnerId: saved.winnerId,
    editedAt: saved.scoreEditedAt!.toISOString(),
    editedBy: caller.name,
  });
});

/** C5: a league admin corrects a completed match's score from Manage. Standings recompute. */
router.put("/leagues/:leagueId/matches/:matchId/score", requireLeagueAdmin, async (req, res) => {
  const { userId } = getAuth(req);
  const leagueId = res.locals.leagueId as number;
  const matchId = parseInt(String(req.params.matchId));
  if (isNaN(matchId)) { res.status(400).json({ error: "Invalid id" }); return; }
  if (typeof req.body?.score !== "string") { res.status(400).json({ error: "Enter the score for each set, like 6-4." }); return; }

  const [match] = await db
    .select()
    .from(matchesTable)
    .where(and(eq(matchesTable.id, matchId), eq(matchesTable.leagueId, leagueId)));
  if (!match) { res.status(404).json({ error: "Match not found" }); return; }

  // A playoff score can be corrected until the match it feeds is played, and
  // nothing changes once the league has ended (Q9).
  const [league] = await db.select({ endedAt: leaguesTable.endedAt, status: leaguesTable.status }).from(leaguesTable).where(eq(leaguesTable.id, leagueId));
  const feeds = await nextPlayoffMatch(match);
  const check = checkCorrection(match, feeds, leagueHasEnded(league));
  if (!check.ok) { res.status(check.status).json({ error: check.error }); return; }

  // The admin enters the score from player 1's side, as Manage shows it.
  const parsed = parseMatchScore(req.body.score);
  if (!parsed.ok) { res.status(400).json({ error: parsed.error }); return; }
  const storedScore = scoreFromSide(parsed.score, 1);
  const winnerId = winnerIdFor(match, parsed.winnerSide);

  const [[player], [user]] = await Promise.all([
    db.select({ name: playersTable.name }).from(playersTable).where(and(eq(playersTable.leagueId, leagueId), eq(playersTable.clerkUserId, userId!))),
    db.select({ displayName: usersTable.displayName }).from(usersTable).where(eq(usersTable.clerkUserId, userId!)),
  ]);
  const adminName = player?.name ?? user?.displayName ?? "League admin";

  const [saved] = await db
    .update(matchesTable)
    .set({ score: storedScore, winnerId, correctedAt: new Date(), correctedByClerkUserId: userId!, correctedByName: adminName })
    .where(and(eq(matchesTable.id, matchId), eq(matchesTable.status, "completed"), isNull(matchesTable.voidedAt)))
    .returning();
  if (!saved) { res.status(409).json({ error: "This match changed. Pull down to see the latest." }); return; }

  if (match.playoffBracketId) {
    // The corrected winner takes the spot in the next round.
    if (feeds && match.winnerId !== winnerId && match.playoffSlot) {
      const position = advanceTo(match.playoffSlot).position;
      await db.update(matchesTable).set(position === 1 ? { player1Id: winnerId } : { player2Id: winnerId }).where(eq(matchesTable.id, feeds.id));
    }
  } else if (!match.inGrace) {
    await applyRecordChanges(match, winnerSideOf(match), parsed.winnerSide);
  }
  await awardMilestonesForMatch(matchId);
  leagueChat.resultEntered(leagueId, saved.id, { edited: true });
  res.json({
    matchId: saved.id,
    score: saved.score,
    winnerId: saved.winnerId,
    correctedAt: saved.correctedAt!.toISOString(),
    correctedBy: saved.correctedByName,
  });
});

/**
 * Q5b: after a playoff round's play-by date, a league admin settles a match
 * nobody scored: the score from player 1's side, or a walkover to one player.
 * The winner moves on as usual.
 */
router.post("/leagues/:leagueId/matches/:matchId/result", requireLeagueAdmin, async (req, res) => {
  const { userId } = getAuth(req);
  const leagueId = res.locals.leagueId as number;
  const matchId = parseInt(String(req.params.matchId));
  if (isNaN(matchId)) { res.status(400).json({ error: "Invalid id" }); return; }

  const [[match], [league]] = await Promise.all([
    db.select().from(matchesTable).where(and(eq(matchesTable.id, matchId), eq(matchesTable.leagueId, leagueId))),
    db.select().from(leaguesTable).where(eq(leaguesTable.id, leagueId)),
  ]);
  if (!match || !league) { res.status(404).json({ error: "Match not found" }); return; }
  const problem = settleProblem({
    match,
    leagueEnded: leagueHasEnded(league),
    playBy: await playoffPlayBy(league, match),
    today: todayFor(league),
  });
  if (problem) { res.status(problem.status).json({ error: problem.error }); return; }

  const walkoverTo = req.body?.walkoverWinnerId;
  if (walkoverTo !== undefined && walkoverTo !== null) {
    if (walkoverTo !== match.player1Id && walkoverTo !== match.player2Id) {
      res.status(400).json({ error: "Pick one of the two players for the walkover." });
      return;
    }
    if (!(await walkover(match, walkoverTo))) { res.status(409).json({ error: "This match changed. Pull down to see the latest." }); return; }
    await awardMilestonesForMatch(matchId);
    leagueChat.resultEntered(leagueId, matchId);
    res.status(201).json({ matchId, status: "completed", score: "W/O", winnerId: walkoverTo, inGrace: false, countsForStandings: false });
    return;
  }

  if (typeof req.body?.score !== "string") { res.status(400).json({ error: "Enter the score for each set, like 6-4." }); return; }
  const parsed = parseMatchScore(req.body.score);
  if (!parsed.ok) { res.status(400).json({ error: parsed.error }); return; }
  const winnerId = winnerIdFor(match, parsed.winnerSide);
  const now = new Date().toISOString();
  const [saved] = await db
    .update(matchesTable)
    .set({ status: "completed", score: parsed.score, winnerId, completedAt: now, recordedAt: now, recordedByClerkUserId: userId!, inGrace: false })
    .where(and(eq(matchesTable.id, matchId), ne(matchesTable.status, "completed"), isNull(matchesTable.voidedAt)))
    .returning();
  if (!saved) { res.status(409).json({ error: "A score is already in for this match. The first score entered stands." }); return; }
  await advancePlayoff(saved, winnerId).catch((err) => logger.error({ err, matchId }, "Couldn't advance playoff winner"));
  await awardMilestonesForMatch(matchId);
  leagueChat.resultEntered(leagueId, matchId);
  res.status(201).json({ matchId, status: saved.status, score: saved.score, winnerId, inGrace: false, countsForStandings: false });
});

export default router;
