import { Router, type Request, type Response, type NextFunction } from "express";
import { getAuth } from "@clerk/express";
import { db, leagueRoundByesTable, leagueRoundsTable, leaguesTable, matchesTable, playersTable, type League, type LeagueRound } from "@workspace/db";
import { and, asc, eq, inArray } from "drizzle-orm";
import { getLeagueRole } from "../lib/leagueAccess.js";
import { graceEndFor, leagueToday, roundPhase, roundWindow, LEAGUE_TIME_ZONE } from "../lib/leagueCalendar.js";
import { planBye, planLock, planSwap, unpairedPlayers } from "../lib/roundEdits.js";
import { requireLeagueAdmin } from "../middlewares/requireLeagueAdmin.js";
import { ensureDraft, loadDraftRound, publishRound, repairRound, usesWeeklyRounds } from "../services/leagueRounds.js";
import { bracketFor } from "../services/leaguePlayoffs.js";

// League schedule and the admin's weekly review (spec: Leagues > Weekly loop).
// Players see rounds once they've gone out; admins also see the draft for
// next week and can swap, mark byes, lock, re-pair, or send it out early.

function requireAuth(req: Request, res: Response, next: NextFunction) {
  const { userId } = getAuth(req);
  if (!userId) { res.status(401).json({ error: "Unauthorized" }); return; }
  next();
}

async function buildRounds(league: League, rounds: LeagueRound[], includeDraftDetail: boolean, today: string) {
  // inArray needs at least one id; -1 matches nothing.
  const ids = rounds.length ? rounds.map((r) => r.id) : [-1];
  const [matches, byes, players] = await Promise.all([
    db.select().from(matchesTable).where(inArray(matchesTable.roundId, ids)),
    db.select().from(leagueRoundByesTable).where(inArray(leagueRoundByesTable.roundId, ids)),
    db.select({ id: playersTable.id, name: playersTable.name, leftAt: playersTable.leftAt }).from(playersTable).where(eq(playersTable.leagueId, league.id)),
  ]);
  const name = (id: number) => players.find((p) => p.id === id)?.name ?? "Player";
  const activeIds = players.filter((p) => !p.leftAt).map((p) => p.id);

  return rounds.map((r) => {
    const roundMatches = matches.filter((m) => m.roundId === r.id);
    const roundByes = byes.filter((b) => b.roundId === r.id);
    const phase = roundPhase(r, today);
    const unpaired =
      includeDraftDetail && phase === "draft"
        ? unpairedPlayers({
            published: false,
            matches: roundMatches.filter((m) => !m.voidedAt).map((m) => ({ id: m.id, player1Id: m.player1Id, player2Id: m.player2Id, locked: m.locked })),
            byes: roundByes.map((b) => ({ playerId: b.playerId, setByAdmin: b.setByAdmin })),
            activePlayerIds: activeIds,
          })
        : [];
    return {
      roundId: r.id,
      roundNumber: r.roundNumber,
      startDate: r.startDate,
      deadline: r.endDate,
      graceEnd: graceEndFor(r.endDate),
      phase,
      matches: roundMatches
        .sort((a, b) => a.id - b.id)
        .map((m) => ({
          matchId: m.id,
          player1Id: m.player1Id,
          player1Name: name(m.player1Id),
          player2Id: m.player2Id,
          player2Name: name(m.player2Id),
          status: m.status,
          score: m.score ?? null,
          winnerId: m.winnerId ?? null,
          inGrace: m.inGrace,
          voided: !!m.voidedAt,
          locked: m.locked,
          scheduledAt: m.scheduledAt ?? null,
          location: m.location ?? null,
        })),
      byes: roundByes.map((b) => ({ playerId: b.playerId, playerName: name(b.playerId), setByAdmin: b.setByAdmin })),
      unpaired: unpaired.map((id) => ({ playerId: id, playerName: name(id) })),
    };
  });
}

const router = Router();

/** The whole season: rounds that are out, the admin's draft, and weeks still to come. */
router.get("/leagues/:leagueId/schedule", requireAuth, async (req, res) => {
  const { userId } = getAuth(req);
  const leagueId = parseInt(String(req.params.leagueId));
  if (isNaN(leagueId)) { res.status(400).json({ error: "Invalid league ID" }); return; }
  const [league] = await db.select().from(leaguesTable).where(eq(leaguesTable.id, leagueId));
  if (!league) { res.status(404).json({ error: "League not found" }); return; }

  const isAdmin = (await getLeagueRole(leagueId, userId!)) !== null;
  const today = leagueToday();
  const all = await db.select().from(leagueRoundsTable).where(eq(leagueRoundsTable.leagueId, leagueId)).orderBy(asc(leagueRoundsTable.roundNumber));
  const visible = all.filter((r) => isAdmin || r.publishedAt);
  const rounds = await buildRounds(league, visible, isAdmin, today);

  // Weeks with no round yet, so the schedule shows the whole season.
  const weekly = usesWeeklyRounds(league);
  const upcoming = weekly
    ? Array.from({ length: league.seasonWeeks! }, (_, i) => roundWindow(league.startDate!, i + 1))
        .filter((w) => !all.some((r) => r.roundNumber === w.roundNumber))
        .map((w) => ({ roundNumber: w.roundNumber, startDate: w.startDate, deadline: w.deadline, graceEnd: w.graceEnd }))
    : [];

  res.json({
    leagueId,
    today,
    timeZone: LEAGUE_TIME_ZONE,
    weeklyRounds: weekly,
    isAdmin,
    rounds,
    upcoming,
  });
});

/** The playoff bracket: every slot, played or to come, and the champion. Null before playoffs start. */
router.get("/leagues/:leagueId/bracket", requireAuth, async (req, res) => {
  const leagueId = parseInt(String(req.params.leagueId));
  if (isNaN(leagueId)) { res.status(400).json({ error: "Invalid league ID" }); return; }
  const [league] = await db.select().from(leaguesTable).where(eq(leaguesTable.id, leagueId));
  if (!league) { res.status(404).json({ error: "League not found" }); return; }
  res.json(await bracketFor(league));
});

/** Loads a round of this league for an admin action, or answers with a problem. */
async function adminRound(req: Request, res: Response): Promise<{ league: League; round: LeagueRound } | null> {
  const leagueId = res.locals.leagueId as number;
  const roundId = parseInt(String(req.params.roundId));
  if (isNaN(roundId)) { res.status(400).json({ error: "Invalid round ID" }); return null; }
  const [league] = await db.select().from(leaguesTable).where(eq(leaguesTable.id, leagueId));
  const [round] = await db
    .select()
    .from(leagueRoundsTable)
    .where(and(eq(leagueRoundsTable.id, roundId), eq(leagueRoundsTable.leagueId, leagueId)));
  if (!league || !round) { res.status(404).json({ error: "Round not found" }); return null; }
  if (!usesWeeklyRounds(league)) {
    res.status(400).json({ error: "This league's rounds can't be edited here." });
    return null;
  }
  return { league, round };
}

async function respondWithRound(res: Response, league: League, roundId: number) {
  const [round] = await db.select().from(leagueRoundsTable).where(eq(leagueRoundsTable.id, roundId));
  const [built] = await buildRounds(league, [round], true, leagueToday());
  res.json(built);
}

/** Admins: draft next week's pairings now instead of waiting for the day before. */
router.post("/leagues/:leagueId/rounds/draft-next", requireLeagueAdmin, async (_req, res) => {
  const leagueId = res.locals.leagueId as number;
  const [league] = await db.select().from(leaguesTable).where(eq(leaguesTable.id, leagueId));
  if (!league) { res.status(404).json({ error: "League not found" }); return; }
  if (!usesWeeklyRounds(league)) { res.status(400).json({ error: "This league's rounds can't be drafted here." }); return; }

  const rounds = await db.select().from(leagueRoundsTable).where(eq(leagueRoundsTable.leagueId, leagueId));
  const today = leagueToday();
  for (let n = 1; n <= league.seasonWeeks!; n++) {
    const existing = rounds.find((r) => r.roundNumber === n);
    if (existing?.publishedAt) continue;
    if (roundWindow(league.startDate!, n).deadline < today) continue;
    const result = await ensureDraft(league, n);
    if (!result) { res.status(409).json({ error: "A league needs at least 2 players to pair." }); return; }
    await respondWithRound(res, league, result.round.id);
    return;
  }
  res.status(409).json({ error: "Every round this season has gone out." });
});

/** Admins: re-pair a draft, keeping locked matches and byes you set. */
router.post("/leagues/:leagueId/rounds/:roundId/repair", requireLeagueAdmin, async (req, res) => {
  const found = await adminRound(req, res);
  if (!found) return;
  if (found.round.publishedAt) { res.status(409).json({ error: "This round has already gone out to players." }); return; }
  await repairRound(found.league, found.round);
  await respondWithRound(res, found.league, found.round.id);
});

/** Admins: send a draft out to players now. */
router.post("/leagues/:leagueId/rounds/:roundId/publish", requireLeagueAdmin, async (req, res) => {
  const found = await adminRound(req, res);
  if (!found) return;
  if (found.round.publishedAt) { res.status(409).json({ error: "This round has already gone out to players." }); return; }
  await publishRound(found.league, found.round);
  await respondWithRound(res, found.league, found.round.id);
});

/** Admins: swap two players' places in a draft. */
router.post("/leagues/:leagueId/rounds/:roundId/swap", requireLeagueAdmin, async (req, res) => {
  const found = await adminRound(req, res);
  if (!found) return;
  const a = Number(req.body?.playerAId);
  const b = Number(req.body?.playerBId);
  if (!Number.isInteger(a) || !Number.isInteger(b)) { res.status(400).json({ error: "Pick two players to swap." }); return; }

  const plan = planSwap(await loadDraftRound(found.round), a, b);
  if ("error" in plan) { res.status(409).json({ error: plan.error }); return; }
  await db.transaction(async (tx) => {
    for (const u of plan.matchUpdates) {
      await tx.update(matchesTable).set({ player1Id: u.player1Id, player2Id: u.player2Id }).where(eq(matchesTable.id, u.matchId));
    }
    for (const m of plan.byeMoves) {
      await tx
        .update(leagueRoundByesTable)
        .set({ playerId: m.toPlayerId })
        .where(and(eq(leagueRoundByesTable.roundId, found.round.id), eq(leagueRoundByesTable.playerId, m.fromPlayerId)));
    }
  });
  await respondWithRound(res, found.league, found.round.id);
});

/** Admins: give a player a bye this round. Their opponent waits to be re-paired. */
router.post("/leagues/:leagueId/rounds/:roundId/byes", requireLeagueAdmin, async (req, res) => {
  const found = await adminRound(req, res);
  if (!found) return;
  const playerId = Number(req.body?.playerId);
  if (!Number.isInteger(playerId)) { res.status(400).json({ error: "Pick a player." }); return; }

  const plan = planBye(await loadDraftRound(found.round), playerId);
  if ("error" in plan) { res.status(409).json({ error: plan.error }); return; }
  await db.transaction(async (tx) => {
    if (plan.deleteMatchId) await tx.delete(matchesTable).where(eq(matchesTable.id, plan.deleteMatchId));
    await tx.insert(leagueRoundByesTable).values({ roundId: found.round.id, playerId, setByAdmin: true }).onConflictDoNothing();
  });
  await respondWithRound(res, found.league, found.round.id);
});

/** Admins: take a bye away. The player waits to be paired. */
router.delete("/leagues/:leagueId/rounds/:roundId/byes/:playerId", requireLeagueAdmin, async (req, res) => {
  const found = await adminRound(req, res);
  if (!found) return;
  if (found.round.publishedAt) { res.status(409).json({ error: "This round has already gone out to players." }); return; }
  const playerId = parseInt(String(req.params.playerId));
  await db
    .delete(leagueRoundByesTable)
    .where(and(eq(leagueRoundByesTable.roundId, found.round.id), eq(leagueRoundByesTable.playerId, playerId)));
  await respondWithRound(res, found.league, found.round.id);
});

/** Admins: lock or unlock a pairing so a re-pair keeps it. */
router.post("/leagues/:leagueId/rounds/:roundId/matches/:matchId/lock", requireLeagueAdmin, async (req, res) => {
  const found = await adminRound(req, res);
  if (!found) return;
  const matchId = parseInt(String(req.params.matchId));
  const locked = req.body?.locked !== false;
  const problem = planLock(await loadDraftRound(found.round), matchId);
  if (problem) { res.status(409).json({ error: problem }); return; }
  await db.update(matchesTable).set({ locked }).where(eq(matchesTable.id, matchId));
  await respondWithRound(res, found.league, found.round.id);
});

export default router;
