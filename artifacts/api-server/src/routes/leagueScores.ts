import { Router } from "express";
import { getAuth } from "@clerk/express";
import { db, leagueRoundsTable, leaguesTable, matchesTable, playersTable, usersTable } from "@workspace/db";
import { and, eq, inArray, isNull, ne, sql } from "drizzle-orm";
import { leagueToday } from "../lib/leagueCalendar.js";
import {
  checkScoreEntry,
  matchParticipantIds,
  parseMatchScore,
  scoreFromSide,
  winnerIdFor,
} from "../lib/leagueScoring.js";
import { checkCorrection, checkUndo, recordChanges } from "../lib/leagueScoreChanges.js";
import { advanceTo, nextRound, type PlayoffRound } from "../lib/playoffs.js";
import { requireLeagueAdmin } from "../middlewares/requireLeagueAdmin.js";
import { advancePlayoffWinner } from "../services/playoffBracket.js";
import { advancePlayoff } from "../services/leaguePlayoffs.js";
import { usesWeeklyRounds } from "../services/leagueRounds.js";
import { sendPushToUsers } from "./notifications.js";
import { logger } from "../lib/logger.js";

// Enter a league score (spec: Leagues > Scores and standings). Either player
// enters it, from their own side ("6-3, 6-4" means they won both sets). The
// first score entered stands, except that the player who entered it can undo
// it for 10 minutes, and a league admin can correct it from Manage (C4, C5).

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

  // An ended league's standings are frozen (decision 31).
  const [owner] = await db.select({ endedAt: leaguesTable.endedAt }).from(leaguesTable).where(eq(leaguesTable.id, leagueId));
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
      scoreClearedAt: null,
      scoreClearedByName: null,
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

/** C4: the player who entered a score can undo it for 10 minutes. Standings recompute. */
router.post("/leagues/:leagueId/matches/:matchId/score/undo", async (req, res) => {
  const { userId } = getAuth(req);
  if (!userId) { res.status(401).json({ error: "Unauthorized" }); return; }
  const leagueId = parseInt(String(req.params.leagueId));
  const matchId = parseInt(String(req.params.matchId));
  if (isNaN(leagueId) || isNaN(matchId)) { res.status(400).json({ error: "Invalid id" }); return; }

  const [match] = await db
    .select()
    .from(matchesTable)
    .where(and(eq(matchesTable.id, matchId), eq(matchesTable.leagueId, leagueId)));
  if (!match) { res.status(404).json({ error: "Match not found" }); return; }

  const check = checkUndo(match, userId, new Date());
  if (!check.ok) { res.status(check.status).json({ error: check.error }); return; }
  const [me] = await db
    .select({ name: playersTable.name })
    .from(playersTable)
    .where(and(eq(playersTable.leagueId, leagueId), eq(playersTable.clerkUserId, userId)));

  // Only clears the score this caller entered, so a race can't undo another one.
  const [cleared] = await db
    .update(matchesTable)
    .set({
      status: "scheduled",
      score: null,
      winnerId: null,
      completedAt: null,
      recordedAt: null,
      recordedByClerkUserId: null,
      inGrace: false,
      // The opponent sees "Score cleared by {name}" until a new score is in.
      scoreClearedAt: new Date(),
      scoreClearedByName: me?.name ?? "your opponent",
    })
    .where(and(
      eq(matchesTable.id, matchId),
      eq(matchesTable.status, "completed"),
      eq(matchesTable.recordedByClerkUserId, userId),
      eq(matchesTable.recordedAt, match.recordedAt!),
      isNull(matchesTable.correctedAt),
    ))
    .returning();
  if (!cleared) { res.status(409).json({ error: "This score changed. Pull down to see the latest." }); return; }

  if (!match.inGrace) await applyRecordChanges(match, winnerSideOf(match), null);
  res.json({ matchId, status: cleared.status, score: null, winnerId: null });
});

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

  // A playoff score can be corrected until the match it feeds is played.
  const feeds = await nextPlayoffMatch(match);
  const check = checkCorrection(match, feeds);
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
  res.json({
    matchId: saved.id,
    score: saved.score,
    winnerId: saved.winnerId,
    correctedAt: saved.correctedAt!.toISOString(),
    correctedBy: saved.correctedByName,
  });
});

export default router;
