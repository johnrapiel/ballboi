import { Router, type IRouter, type NextFunction, type Request, type Response } from "express";
import { getAuth } from "@clerk/express";
import {
  ballBoiDoublesViewsTable,
  ballBoiSessionsTable,
  db,
  leagueRoundsTable,
  leaguesTable,
  matchesTable,
  matchInvitesTable,
  playersTable,
  playoffBracketsTable,
} from "@workspace/db";
import { and, desc, eq, gte, inArray, isNull, ne, or } from "drizzle-orm";
import pino from "pino";
import {
  isRecordableNow,
  parseWhen,
  playByFor,
  recordListOrder,
  recordingStage,
  toRecordableMatch,
  type RecordableMatch,
  type RecordContext,
} from "../lib/recordableMatches";
import { planDiscard } from "../lib/recordingDiscard";

// Ball Boi recording: the matches a player can record now.
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
 * What the caller can record now (PR 4): every unplayed league match in its
 * round's week, grace week included, any day that week; playoff matches
 * while the bracket is on; and Quick matches scheduled in [from, to). A match
 * with a set time in [from, to) comes first. Singles and doubles both come
 * back; the app shows doubles as disabled.
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
    const unplayed = rows.filter((m) => !m.score && !m.voidedAt && m.status !== "completed");
    // inArray needs at least one id; -1 matches nothing.
    const ids = (xs: (number | null)[]) => {
      const out = [...new Set(xs.filter((x): x is number => x != null))];
      return out.length ? out : [-1];
    };
    const [rounds, leagues, brackets] = await Promise.all([
      db
        .select({ id: leagueRoundsTable.id, startDate: leagueRoundsTable.startDate, endDate: leagueRoundsTable.endDate, publishedAt: leagueRoundsTable.publishedAt })
        .from(leagueRoundsTable)
        .where(inArray(leagueRoundsTable.id, ids(unplayed.map((m) => m.roundId)))),
      db
        .select({ id: leaguesTable.id, name: leaguesTable.name, timeZone: leaguesTable.timeZone, endedAt: leaguesTable.endedAt })
        .from(leaguesTable)
        .where(inArray(leaguesTable.id, ids(unplayed.map((m) => m.leagueId)))),
      db
        .select({ id: playoffBracketsTable.id, status: playoffBracketsTable.status })
        .from(playoffBracketsTable)
        .where(inArray(playoffBracketsTable.id, ids(unplayed.map((m) => m.playoffBracketId)))),
    ]);
    const ctx: RecordContext = {
      now: new Date(),
      from,
      to,
      rounds: new Map(rounds.map((r) => [r.id, r])),
      leagues: new Map(leagues.map((l) => [l.id, l])),
      activeBrackets: new Set(brackets.filter((b) => b.status === "active").map((b) => b.id)),
    };
    const recordable = unplayed.filter((m) => isRecordableNow(m, ctx));
    if (recordable.length === 0) {
      res.json([]);
      return;
    }
    const playerIds = [
      ...new Set(recordable.flatMap((m) => [m.player1Id, m.player2Id, m.player3Id, m.player4Id]).filter((id): id is number => id != null)),
    ];
    const players = await db.select({ id: playersTable.id, name: playersTable.name }).from(playersTable).where(inArray(playersTable.id, playerIds));
    const names = Object.fromEntries(players.map((p) => [p.id, p.name]));
    const leagueNames = Object.fromEntries(leagues.map((l) => [l.id, l.name]));
    const out = recordable
      .map((m) => {
        const described = toRecordableMatch(m, myIds, names, leagueNames);
        return described ? { ...described, ...playByFor(m, ctx) } : null;
      })
      .filter((m): m is RecordableMatch => m != null)
      .sort(recordListOrder(from, to));
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

/**
 * POST /recording/discard { matchId, sessionId? }
 * Throws away a recording that hasn't finished uploading: from the "Keep this
 * recording?" sheet (no session yet) or the processing card's Discard. See
 * lib/recordingDiscard.ts for what's removed and what's left alone.
 */
router.post("/recording/discard", requireAuth, async (req: Request, res: Response) => {
  const userId = getAuth(req).userId!;
  const matchId = Number(req.body?.matchId);
  const rawSession = req.body?.sessionId;
  const sessionRequested = rawSession != null;
  const sessionId = Number(rawSession);
  if (!Number.isInteger(matchId) || matchId <= 0 || (sessionRequested && (!Number.isInteger(sessionId) || sessionId <= 0))) {
    res.status(400).json({ error: "matchId is required; sessionId must be a number when sent." });
    return;
  }
  try {
    const [match] = await db.select().from(matchesTable).where(eq(matchesTable.id, matchId));
    if (!match) {
      // Already gone (a retry after the placeholder match was removed): nothing left to discard.
      res.json({ sessionDeleted: false, matchRemoved: true });
      return;
    }
    const [mine, sessions, invites] = await Promise.all([
      db.select({ id: playersTable.id }).from(playersTable).where(eq(playersTable.clerkUserId, userId)),
      sessionRequested
        ? db.select().from(ballBoiSessionsTable).where(eq(ballBoiSessionsTable.id, sessionId))
        : Promise.resolve([] as (typeof ballBoiSessionsTable.$inferSelect)[]),
      db
        .select({ placeholderPlayerId: matchInvitesTable.placeholderPlayerId })
        .from(matchInvitesTable)
        .where(and(eq(matchInvitesTable.matchId, matchId), isNull(matchInvitesTable.claimedByClerkUserId))),
    ]);
    const others = await db
      .select({ id: ballBoiSessionsTable.id })
      .from(ballBoiSessionsTable)
      .where(
        sessionRequested
          ? and(eq(ballBoiSessionsTable.matchId, matchId), ne(ballBoiSessionsTable.id, sessionId))
          : eq(ballBoiSessionsTable.matchId, matchId),
      );
    const plan = planDiscard({
      match,
      matchId,
      callerPlayerIds: mine.map((p) => p.id),
      callerClerkUserId: userId,
      session: sessions[0] ?? null,
      sessionRequested,
      unclaimedPlaceholderPlayerId: invites[0]?.placeholderPlayerId ?? null,
      otherSessionCount: others.length,
    });
    if (!plan.ok) {
      res.status(plan.status).json({ error: plan.error });
      return;
    }
    await db.transaction(async (tx) => {
      if (plan.deleteSessionId != null) {
        await tx.delete(ballBoiSessionsTable).where(eq(ballBoiSessionsTable.id, plan.deleteSessionId));
      }
      if (plan.removePlaceholderPlayerId != null) {
        // Removing the placeholder removes its match and invite with it (foreign keys cascade).
        await tx
          .delete(playersTable)
          .where(and(eq(playersTable.id, plan.removePlaceholderPlayerId), isNull(playersTable.clerkUserId)));
      }
    });
    res.json({ sessionDeleted: plan.deleteSessionId != null, matchRemoved: plan.removePlaceholderPlayerId != null });
  } catch (err) {
    logger.error({ err }, "Failed to discard a recording");
    res.status(500).json({ error: "Couldn't discard the recording. Try again." });
  }
});

export default router;
