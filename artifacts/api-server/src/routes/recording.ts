import { Router, type IRouter, type NextFunction, type Request, type Response } from "express";
import { getAuth } from "@clerk/express";
import { ballBoiDoublesViewsTable, ballBoiSessionsTable, db, leaguesTable, matchesTable, playersTable } from "@workspace/db";
import { and, desc, eq, gte, inArray, or } from "drizzle-orm";
import pino from "pino";
import {
  byScheduledTime,
  isRecordableToday,
  parseWhen,
  recordingStage,
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

/** How far back the Ball Boi tab lists your recordings. */
const RECENT_DAYS = 60;

/**
 * GET /recording/sessions
 * The caller's recent recordings on the server, newest first, for the Ball
 * Boi tab's processing cards. Recordings still on the phone come from the
 * phone's own upload queue, not from here.
 */
router.get("/recording/sessions", requireAuth, async (req: Request, res: Response) => {
  const userId = getAuth(req).userId!;
  try {
    const since = new Date(Date.now() - RECENT_DAYS * 24 * 60 * 60 * 1000);
    const sessions = await db
      .select({
        id: ballBoiSessionsTable.id,
        matchId: ballBoiSessionsTable.matchId,
        status: ballBoiSessionsTable.status,
        processingStatus: ballBoiSessionsTable.processingStatus,
        createdAt: ballBoiSessionsTable.createdAt,
      })
      .from(ballBoiSessionsTable)
      .where(and(eq(ballBoiSessionsTable.recordedByClerkUserId, userId), gte(ballBoiSessionsTable.createdAt, since)))
      .orderBy(desc(ballBoiSessionsTable.createdAt))
      .limit(30);
    if (sessions.length === 0) {
      res.json([]);
      return;
    }
    const matchIds = [...new Set(sessions.map((s) => s.matchId))];
    const [matches, me] = await Promise.all([
      db.select().from(matchesTable).where(inArray(matchesTable.id, matchIds)),
      db.select({ id: playersTable.id }).from(playersTable).where(eq(playersTable.clerkUserId, userId)),
    ]);
    const myIds = me.map((p) => p.id);
    const playerIds = [
      ...new Set(matches.flatMap((m) => [m.player1Id, m.player2Id, m.player3Id, m.player4Id]).filter((id): id is number => id != null)),
    ];
    const players = playerIds.length
      ? await db.select({ id: playersTable.id, name: playersTable.name }).from(playersTable).where(inArray(playersTable.id, playerIds))
      : [];
    const names = Object.fromEntries(players.map((p) => [p.id, p.name]));
    const byId = new Map(matches.map((m) => [m.id, m]));
    res.json(
      sessions.map((s) => {
        const m = byId.get(s.matchId);
        const described = m ? toRecordableMatch(m, myIds, names, {}) : null;
        return {
          sessionId: s.id,
          matchId: s.matchId,
          opponentName: described?.opponentName ?? "Opponent",
          recordedAt: s.createdAt.toISOString(),
          stage: recordingStage(s.status, s.processingStatus),
          scoreEntered: !!m?.score,
        };
      }),
    );
  } catch (err) {
    logger.error({ err }, "Failed to list recordings");
    res.status(500).json({ error: "Couldn't load your recordings." });
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
