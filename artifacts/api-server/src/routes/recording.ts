import { Router, type IRouter, type NextFunction, type Request, type Response } from "express";
import { getAuth } from "@clerk/express";
import { ballBoiDoublesViewsTable, db, leaguesTable, matchesTable, playersTable } from "@workspace/db";
import { eq, inArray, or } from "drizzle-orm";
import pino from "pino";
import {
  byScheduledTime,
  isRecordableToday,
  parseWhen,
  toRecordableMatch,
  type RecordableMatch,
} from "../lib/recordableMatches";

// Ball Boi recording: the matches a player can record today.
// Spec: Ball Boi > Recording ("Every recording starts from a match").

const logger = pino({ name: "recording" });
const router: IRouter = Router();

function requireAuth(req: Request, res: Response, next: NextFunction) {
  if (!getAuth(req).userId) {
    res.status(401).json({ error: "Unauthorized" });
    return;
  }
  next();
}

/** The phone sends its own local day, so "today" follows the player's time zone. */
const MAX_WINDOW_MS = 48 * 60 * 60 * 1000;

/**
 * GET /recording/todays-matches?from=<ISO>&to=<ISO>
 * The caller's unplayed matches scheduled in [from, to), earliest first.
 * Singles and doubles both come back; the app shows doubles as disabled.
 */
router.get("/recording/todays-matches", requireAuth, async (req: Request, res: Response) => {
  const userId = getAuth(req).userId!;
  const from = parseWhen(req.query.from);
  const to = parseWhen(req.query.to);
  if (!from || !to || to <= from || to.getTime() - from.getTime() > MAX_WINDOW_MS) {
    res.status(400).json({ error: "Send from and to as dates, at most 48 hours apart." });
    return;
  }
  try {
    const me = await db.select({ id: playersTable.id }).from(playersTable).where(eq(playersTable.clerkUserId, userId));
    const myIds = me.map((p) => p.id);
    if (myIds.length === 0) {
      res.json([]);
      return;
    }
    const rows = await db
      .select()
      .from(matchesTable)
      .where(
        or(
          inArray(matchesTable.player1Id, myIds),
          inArray(matchesTable.player2Id, myIds),
          inArray(matchesTable.player3Id, myIds),
          inArray(matchesTable.player4Id, myIds),
        ),
      );
    const today = rows.filter((m) => isRecordableToday(m, from, to));
    if (today.length === 0) {
      res.json([]);
      return;
    }
    const playerIds = [
      ...new Set(today.flatMap((m) => [m.player1Id, m.player2Id, m.player3Id, m.player4Id]).filter((id): id is number => id != null)),
    ];
    const leagueIds = [...new Set(today.map((m) => m.leagueId).filter((id): id is number => id != null))];
    const [players, leagues] = await Promise.all([
      db.select({ id: playersTable.id, name: playersTable.name }).from(playersTable).where(inArray(playersTable.id, playerIds)),
      leagueIds.length
        ? db.select({ id: leaguesTable.id, name: leaguesTable.name }).from(leaguesTable).where(inArray(leaguesTable.id, leagueIds))
        : Promise.resolve([] as { id: number; name: string }[]),
    ]);
    const names = Object.fromEntries(players.map((p) => [p.id, p.name]));
    const leagueNames = Object.fromEntries(leagues.map((l) => [l.id, l.name]));
    const out = today
      .map((m) => toRecordableMatch(m, myIds, names, leagueNames))
      .filter((m): m is RecordableMatch => m != null)
      .sort(byScheduledTime);
    res.json(out);
  } catch (err) {
    logger.error({ err }, "Failed to list today's matches");
    res.status(500).json({ error: "Couldn't load today's matches." });
  }
});

/**
 * POST /recording/doubles-views { matchId }
 * Someone saw "Ball Boi analyzes singles for now. Doubles is coming." on a
 * doubles match. Counted once per person per match, as a demand signal.
 */
router.post("/recording/doubles-views", requireAuth, async (req: Request, res: Response) => {
  const userId = getAuth(req).userId!;
  const matchId = Number(req.body?.matchId);
  if (!Number.isInteger(matchId) || matchId <= 0) {
    res.status(400).json({ error: "matchId is required." });
    return;
  }
  try {
    await db.insert(ballBoiDoublesViewsTable).values({ clerkUserId: userId, matchId }).onConflictDoNothing();
    res.status(204).end();
  } catch (err) {
    logger.error({ err }, "Failed to log a doubles view");
    res.status(500).json({ error: "Couldn't log the view." });
  }
});

export default router;
