import { Router } from "express";
import { getAuth } from "@clerk/express";
import { ballBoiSessionsTable, db, leagueRoundsTable, leaguesTable, matchesTable, matchShotsTable, playersTable, usersTable } from "@workspace/db";
import { and, count, desc, eq, inArray } from "drizzle-orm";
import { matchParticipantIds } from "../lib/leagueScoring.js";
import { buildMatchDetail } from "../lib/matchDetail.js";
import { blockedAccountsFor } from "../lib/blocks.js";

// Match detail (finding 6): opened from Home's recent results and My matches.
// Only the players in the match can open it.

const router = Router();

router.get("/me/matches/:matchId", async (req, res) => {
  const { userId } = getAuth(req);
  if (!userId) { res.status(401).json({ error: "Unauthorized" }); return; }
  const matchId = parseInt(String(req.params.matchId));
  if (isNaN(matchId)) { res.status(400).json({ error: "Invalid id" }); return; }

  const [match] = await db.select().from(matchesTable).where(eq(matchesTable.id, matchId));
  if (!match || match.leagueId == null) { res.status(404).json({ error: "Match not found" }); return; }

  const players = await db
    .select({
      id: playersTable.id,
      name: playersTable.name,
      clerkUserId: playersTable.clerkUserId,
      displayName: usersTable.displayName,
      avatarUrl: usersTable.avatarUrl,
    })
    .from(playersTable)
    .leftJoin(usersTable, eq(usersTable.clerkUserId, playersTable.clerkUserId))
    .where(inArray(playersTable.id, matchParticipantIds(match)));
  if (!players.some((p) => p.clerkUserId === userId)) { res.status(403).json({ error: "Only the players in this match can see it." }); return; }

  const [[league], [round], [session], hidden] = await Promise.all([
    db.select().from(leaguesTable).where(eq(leaguesTable.id, match.leagueId)),
    match.roundId
      ? db.select({ roundNumber: leagueRoundsTable.roundNumber }).from(leagueRoundsTable).where(eq(leagueRoundsTable.id, match.roundId))
      : Promise.resolve([]),
    // The Ball Boi Replay row shows only once an analysis has finished.
    db
      .select({ id: ballBoiSessionsTable.id, durationSeconds: ballBoiSessionsTable.durationSeconds })
      .from(ballBoiSessionsTable)
      .where(and(eq(ballBoiSessionsTable.matchId, matchId), eq(ballBoiSessionsTable.status, "completed")))
      .orderBy(desc(ballBoiSessionsTable.createdAt))
      .limit(1),
    // No photo for someone with a block either way.
    blockedAccountsFor(userId),
  ]);
  if (!league) { res.status(404).json({ error: "Match not found" }); return; }
  const shots = session
    ? (await db.select({ n: count() }).from(matchShotsTable).where(eq(matchShotsTable.sessionId, session.id)))[0]?.n ?? 0
    : 0;

  res.json(
    buildMatchDetail({
      match,
      league,
      // A1: a signed-up player's profile name; a placeholder's name from the row.
      // A placeholder (no account) has no photo.
      players: players.map((p) => ({
        id: p.id,
        name: (p.clerkUserId ? p.displayName?.trim() : null) || p.name,
        clerkUserId: p.clerkUserId,
        avatarUrl: p.clerkUserId && !hidden.has(p.clerkUserId) ? (p.avatarUrl ?? null) : null,
      })),
      roundNumber: round?.roundNumber ?? null,
      userId,
      replay: session ? { durationSeconds: session.durationSeconds ?? null, shotCount: Number(shots) } : null,
      now: new Date(),
    }),
  );
});

export default router;
