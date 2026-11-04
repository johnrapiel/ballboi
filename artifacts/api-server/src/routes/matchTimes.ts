import { Router } from "express";
import { getAuth } from "@clerk/express";
import { db, leagueRoundsTable, leaguesTable, matchesTable, playersTable } from "@workspace/db";
import { and, eq, isNull } from "drizzle-orm";
import { getLeagueRole } from "../lib/leagueAccess.js";
import { leagueZone } from "../lib/leagueCalendar.js";
import { checkLeagueMatchTime, checkMatchTime } from "../lib/matchTimes.js";
import { logger } from "../lib/logger.js";
import { requireLeagueAdmin } from "../middlewares/requireLeagueAdmin.js";
import { applyMatchTimeToDrafts } from "../services/leagueRounds.js";

// League match times (PR 4). An admin can set one weekly match day and time
// for a club league; otherwise either player picks a time for their match
// inside its week. A set time never gates recording: it only moves the match
// to the top on its day.

const router = Router();

/** Either player in the match, or a league admin, sets (or clears) its date and time. */
router.put("/leagues/:leagueId/matches/:matchId/time", async (req, res) => {
  const { userId } = getAuth(req);
  if (!userId) { res.status(401).json({ error: "Unauthorized" }); return; }
  const leagueId = parseInt(String(req.params.leagueId));
  const matchId = parseInt(String(req.params.matchId));
  if (isNaN(leagueId) || isNaN(matchId)) { res.status(400).json({ error: "Invalid id" }); return; }
  if (!req.body || !("scheduledAt" in req.body)) { res.status(400).json({ error: "Pick a date and time." }); return; }

  try {
    const [league] = await db.select().from(leaguesTable).where(eq(leaguesTable.id, leagueId));
    if (!league) { res.status(404).json({ error: "League not found" }); return; }
    const [match] = await db
      .select()
      .from(matchesTable)
      .where(and(eq(matchesTable.id, matchId), eq(matchesTable.leagueId, leagueId)));
    if (!match) { res.status(404).json({ error: "Match not found" }); return; }

    const [rounds, callerPlayers, role] = await Promise.all([
      match.roundId
        ? db.select().from(leagueRoundsTable).where(eq(leagueRoundsTable.id, match.roundId))
        : Promise.resolve([]),
      db
        .select({ id: playersTable.id })
        .from(playersTable)
        .where(and(eq(playersTable.leagueId, leagueId), eq(playersTable.clerkUserId, userId), isNull(playersTable.leftAt))),
      getLeagueRole(leagueId, userId),
    ]);

    const check = checkMatchTime({
      league,
      match,
      round: rounds[0] ?? null,
      scheduledAt: req.body.scheduledAt,
      callerPlayerIds: callerPlayers.map((p) => p.id),
      isAdmin: role !== null,
      now: new Date(),
    });
    if (!check.ok) { res.status(check.status).json({ error: check.error }); return; }

    await db.update(matchesTable).set({ scheduledAt: check.scheduledAt }).where(eq(matchesTable.id, matchId));
    res.json({ matchId, scheduledAt: check.scheduledAt, timeZone: leagueZone(league) });
  } catch (err) {
    logger.error({ err, leagueId, matchId }, "Failed to set a match time");
    res.status(500).json({ error: "Couldn't save the match time." });
  }
});

/** League admins: set the weekly match day and time, or clear it so players pick. */
router.put("/leagues/:leagueId/match-time", requireLeagueAdmin, async (req, res) => {
  const leagueId = res.locals.leagueId as number;
  const check = checkLeagueMatchTime(req.body ?? {});
  if (!check.ok) { res.status(400).json({ error: check.error }); return; }
  try {
    const [league] = await db
      .update(leaguesTable)
      .set({ matchDay: check.matchDay, matchTime: check.matchTime })
      .where(eq(leaguesTable.id, leagueId))
      .returning();
    if (!league) { res.status(404).json({ error: "League not found" }); return; }
    // Pairings still in review pick up the new time; rounds already out keep theirs.
    await applyMatchTimeToDrafts(league);
    res.json({ matchDay: league.matchDay ?? null, matchTime: league.matchTime ?? null, timeZone: leagueZone(league) });
  } catch (err) {
    logger.error({ err, leagueId }, "Failed to set the league match time");
    res.status(500).json({ error: "Couldn't save the match time." });
  }
});

export default router;
