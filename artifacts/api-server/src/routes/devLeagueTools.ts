import { Router, type NextFunction, type Request, type Response } from "express";
import { db, leagueRoundsTable, leaguesTable } from "@workspace/db";
import { asc, eq } from "drizzle-orm";
import { devToolsAllowed, targetRound, TIME_ACTIONS, type TimeAction } from "../lib/devTime.js";
import { leagueToday } from "../lib/leagueCalendar.js";
import { requireLeagueAdmin } from "../middlewares/requireLeagueAdmin.js";
import { applyTimeAction, pairNow } from "../services/devLeagueTime.js";
import { usesWeeklyRounds } from "../services/leagueRounds.js";

// Dev-only league tools for walkthroughs: time jumps and "run Flex pairing
// now". League admins only. Not mounted in production, and every request is
// refused there anyway (lib/devTime.ts devToolsAllowed).

function devOnly(_req: Request, res: Response, next: NextFunction) {
  if (!devToolsAllowed()) {
    res.status(404).json({ error: "Not found" });
    return;
  }
  next();
}

const router = Router();

/** What the Testing tools section shows: today's date and the round the grace-week jumps act on. */
router.get("/dev/leagues/:leagueId/tools", devOnly, requireLeagueAdmin, async (_req, res) => {
  const leagueId = res.locals.leagueId as number;
  const [league] = await db.select().from(leaguesTable).where(eq(leaguesTable.id, leagueId));
  if (!league) { res.status(404).json({ error: "League not found" }); return; }
  const today = leagueToday();
  const rounds = await db.select().from(leagueRoundsTable).where(eq(leagueRoundsTable.leagueId, leagueId)).orderBy(asc(leagueRoundsTable.roundNumber));
  const target = targetRound(
    rounds.map((r) => ({ roundNumber: r.roundNumber, startDate: r.startDate, endDate: r.endDate, published: !!r.publishedAt })),
    today,
  );
  res.json({
    available: usesWeeklyRounds(league),
    today,
    startDate: league.startDate,
    seasonStarted: !!league.startDate && league.startDate <= today,
    targetRound: target ? { roundNumber: target.roundNumber, deadline: target.endDate } : null,
  });
});

/** Jump this league forward: season started, deadline passed, in grace, grace over. */
router.post("/dev/leagues/:leagueId/time", devOnly, requireLeagueAdmin, async (req, res) => {
  const action = req.body?.action as TimeAction;
  if (!(TIME_ACTIONS as readonly string[]).includes(action)) {
    res.status(400).json({ error: `action must be one of ${TIME_ACTIONS.join(", ")}` });
    return;
  }
  const result = await applyTimeAction(res.locals.leagueId as number, action);
  res.status(result.ok ? 200 : 409).json(result);
});

/** Draft the next round now, for review. */
router.post("/dev/leagues/:leagueId/pair-now", devOnly, requireLeagueAdmin, async (_req, res) => {
  const result = await pairNow(res.locals.leagueId as number);
  res.status(result.ok ? 200 : 409).json(result);
});

export default router;
