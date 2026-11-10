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
import { and, desc, eq, gte, inArray, isNull, ne, or, sql } from "drizzle-orm";
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
import { ANALYSIS_MAX_RETRIES, failureReason, retryPending } from "../lib/analysisFailure";
import { deleteSessionFiles } from "../lib/sessionFiles";
import { checkSidecar, cleanConditions, sidecarObjectPath, withConditions } from "../lib/recordingSidecar";
import { ObjectStorageService } from "../lib/objectStorage";
import { shownStats } from "../lib/statGates";

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
    let recordable = unplayed.filter((m) => isRecordableNow(m, ctx));
    // A Quick match exists for one recording. Once it's recorded it shows
    // under Your recordings (with Enter score), not here again (D6).
    const quickIds = recordable.filter((m) => m.leagueId == null).map((m) => m.id);
    if (quickIds.length > 0) {
      const recorded = await db
        .select({ matchId: ballBoiSessionsTable.matchId })
        .from(ballBoiSessionsTable)
        .where(inArray(ballBoiSessionsTable.matchId, quickIds));
      const done = new Set(recorded.map((r) => r.matchId));
      recordable = recordable.filter((m) => !done.has(m.id));
    }
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

/**
 * Spec decision 88 (B5): while no stat has passed its accuracy bar, a
 * recording that's analyzing or done reads "Uploaded" with a thank-you, not
 * "Analyzing" or "Replay is ready". A finished session knows from its own
 * statGates. One still analyzing goes by the newest finished analysis: if
 * that one showed no stat, nothing has passed yet.
 */
export function stillLearning(
  stage: string,
  sessionMetadata: unknown,
  latestShowsStats: boolean,
): boolean {
  if (stage === "ready") return shownStats(sessionMetadata).size === 0;
  if (stage === "analyzing") return !latestShowsStats;
  return false;
}

const LATEST_GATES_TTL_MS = 10 * 60 * 1000;
let latestGates: { at: number; showsStats: boolean } | null = null;

/** Did the newest finished analysis show any stat? Cached for 10 minutes; errors count as no. */
async function latestShowsStats(): Promise<boolean> {
  if (latestGates && Date.now() - latestGates.at < LATEST_GATES_TTL_MS) return latestGates.showsStats;
  try {
    const [row] = await db
      .select({ metadata: ballBoiSessionsTable.metadata })
      .from(ballBoiSessionsTable)
      .where(and(eq(ballBoiSessionsTable.status, "completed"), sql`${ballBoiSessionsTable.metadata}->'statGates' is not null`))
      .orderBy(desc(ballBoiSessionsTable.updatedAt))
      .limit(1);
    latestGates = { at: Date.now(), showsStats: !!row && shownStats(row.metadata).size > 0 };
  } catch (err) {
    logger.warn({ err }, "Couldn't read the latest stat gates; treating stats as not ready");
    return false;
  }
  return latestGates.showsStats;
}

/** For tests. */
export function resetLatestGatesCache() {
  latestGates = null;
}

/** How far back the Ball Boi tab lists your recordings. */
const RECENT_DAYS = 60;
const RECENT_LIMIT = 30;

/** People who removed someone else's recording from their own list. */
function hiddenFor(metadata: unknown): string[] {
  const m = metadata && typeof metadata === "object" ? (metadata as Record<string, unknown>) : {};
  return Array.isArray(m.hiddenFor) ? m.hiddenFor.filter((x): x is string => typeof x === "string") : [];
}

/**
 * GET /recording/sessions
 * Recent recordings of the caller's matches on the server, newest first, for
 * the Ball Boi tab's cards. Both players see a match's card: whoever recorded
 * it, the opponent, and a placeholder opponent who claimed the invite
 * (John's decision Q15). Recordings still on the phone come from the phone's
 * own upload queue, not from here.
 */
router.get("/recording/sessions", requireAuth, async (req: Request, res: Response) => {
  const userId = getAuth(req).userId!;
  try {
    const since = new Date(Date.now() - RECENT_DAYS * 24 * 60 * 60 * 1000);
    const me = await db.select({ id: playersTable.id }).from(playersTable).where(eq(playersTable.clerkUserId, userId));
    const myIds = me.map((p) => p.id);
    const myMatches = myIds.length
      ? await db
          .select({ id: matchesTable.id })
          .from(matchesTable)
          .where(
            or(
              inArray(matchesTable.player1Id, myIds),
              inArray(matchesTable.player2Id, myIds),
              inArray(matchesTable.player3Id, myIds),
              inArray(matchesTable.player4Id, myIds),
            ),
          )
      : [];
    const myMatchIds = myMatches.map((m) => m.id);
    const found = await db
      .select({
        id: ballBoiSessionsTable.id,
        matchId: ballBoiSessionsTable.matchId,
        status: ballBoiSessionsTable.status,
        processingStatus: ballBoiSessionsTable.processingStatus,
        processingError: ballBoiSessionsTable.processingError,
        metadata: ballBoiSessionsTable.metadata,
        recordedByClerkUserId: ballBoiSessionsTable.recordedByClerkUserId,
        recordingStartedAt: ballBoiSessionsTable.recordingStartedAt,
        createdAt: ballBoiSessionsTable.createdAt,
      })
      .from(ballBoiSessionsTable)
      .where(
        and(
          myMatchIds.length
            ? or(eq(ballBoiSessionsTable.recordedByClerkUserId, userId), inArray(ballBoiSessionsTable.matchId, myMatchIds))
            : eq(ballBoiSessionsTable.recordedByClerkUserId, userId),
          gte(ballBoiSessionsTable.createdAt, since),
        ),
      )
      .orderBy(desc(ballBoiSessionsTable.createdAt))
      .limit(RECENT_LIMIT * 2);
    const sessions = found.filter((s) => !hiddenFor(s.metadata).includes(userId)).slice(0, RECENT_LIMIT);
    if (sessions.length === 0) {
      res.json([]);
      return;
    }
    const matchIds = [...new Set(sessions.map((s) => s.matchId))];
    const matches = await db.select().from(matchesTable).where(inArray(matchesTable.id, matchIds));
    const playerIds = [
      ...new Set(matches.flatMap((m) => [m.player1Id, m.player2Id, m.player3Id, m.player4Id]).filter((id): id is number => id != null)),
    ];
    const players = playerIds.length
      ? await db.select({ id: playersTable.id, name: playersTable.name }).from(playersTable).where(inArray(playersTable.id, playerIds))
      : [];
    const names = Object.fromEntries(players.map((p) => [p.id, p.name]));
    const byId = new Map(matches.map((m) => [m.id, m]));
    const stages = new Map(
      sessions.map((s) => [s.id, recordingStage(s.status, s.processingStatus, retryPending(s, ANALYSIS_MAX_RETRIES))]),
    );
    const anyAnalyzing = [...stages.values()].some((st) => st === "analyzing");
    const latest = anyAnalyzing ? await latestShowsStats() : false;
    res.json(
      sessions.map((s) => {
        const m = byId.get(s.matchId);
        const described = m ? toRecordableMatch(m, myIds, names, {}) : null;
        const stage = stages.get(s.id)!;
        const recordedAt = s.recordingStartedAt ?? s.createdAt;
        return {
          sessionId: s.id,
          matchId: s.matchId,
          leagueId: m?.leagueId ?? null,
          opponentName: described?.opponentName ?? "Opponent",
          // The day the match was recorded, not the day it uploaded (D19).
          recordedAt: new Date(recordedAt).toISOString(),
          stage,
          scoreEntered: !!m?.score,
          recordedByYou: s.recordedByClerkUserId === userId,
          failedReason: stage === "failed" ? failureReason(s.processingError) : null,
          stillLearning: stillLearning(stage, s.metadata, latest),
        };
      }),
    );
  } catch (err) {
    logger.error({ err }, "Failed to list recordings");
    res.status(500).json({ error: "Couldn't load your recordings." });
  }
});

/**
 * POST /recording/sessions/:sessionId/remove
 * Remove on a card: a recording whose analysis failed (Q16), or one that
 * never finished uploading and isn't on the phone anymore (D18).
 * - The person who recorded it: the recording and its files are deleted, for
 *   both players. A lost upload of a Quick match against someone who never
 *   joined, with no score, takes the match with it, like Discard.
 * - The other player: it's taken off their own list only.
 * Analyzing and ready recordings can't be removed here.
 */
router.post("/recording/sessions/:sessionId/remove", requireAuth, async (req: Request, res: Response) => {
  const userId = getAuth(req).userId!;
  const sessionId = Number(req.params.sessionId);
  if (!Number.isInteger(sessionId) || sessionId <= 0) {
    res.status(400).json({ error: "Invalid recording id" });
    return;
  }
  try {
    const [session] = await db.select().from(ballBoiSessionsTable).where(eq(ballBoiSessionsTable.id, sessionId));
    if (!session) {
      // Already gone: a second tap, or the other player removed it.
      res.json({ removed: true, matchRemoved: false });
      return;
    }
    const [match] = await db.select().from(matchesTable).where(eq(matchesTable.id, session.matchId));
    const mine = await db.select({ id: playersTable.id }).from(playersTable).where(eq(playersTable.clerkUserId, userId));
    const myIds = new Set(mine.map((p) => p.id));
    const isRecorder = session.recordedByClerkUserId === userId;
    const inMatch = !!match && [match.player1Id, match.player2Id, match.player3Id, match.player4Id].some((id) => id != null && myIds.has(id));
    if (!isRecorder && !inMatch) {
      res.status(403).json({ error: "Only the players in this match can remove its recording." });
      return;
    }
    const stage = recordingStage(session.status, session.processingStatus, retryPending(session, ANALYSIS_MAX_RETRIES));
    if (stage !== "failed" && stage !== "uploading") {
      res.status(409).json({ error: "This recording can't be removed while it's analyzing or ready." });
      return;
    }
    if (!isRecorder) {
      const metadata = (session.metadata as Record<string, unknown> | null) ?? {};
      await db
        .update(ballBoiSessionsTable)
        .set({ metadata: { ...metadata, hiddenFor: [...new Set([...hiddenFor(metadata), userId])] } })
        .where(eq(ballBoiSessionsTable.id, sessionId));
      res.json({ removed: true, matchRemoved: false });
      return;
    }
    let removePlaceholderPlayerId: number | null = null;
    if (stage === "uploading" && match && match.leagueId == null && !match.score) {
      const [invites, others] = await Promise.all([
        db
          .select({ placeholderPlayerId: matchInvitesTable.placeholderPlayerId })
          .from(matchInvitesTable)
          .where(and(eq(matchInvitesTable.matchId, match.id), isNull(matchInvitesTable.claimedByClerkUserId))),
        db
          .select({ id: ballBoiSessionsTable.id })
          .from(ballBoiSessionsTable)
          .where(and(eq(ballBoiSessionsTable.matchId, match.id), ne(ballBoiSessionsTable.id, sessionId))),
      ]);
      const plan = planDiscard({
        match,
        matchId: match.id,
        callerPlayerIds: [...myIds],
        callerClerkUserId: userId,
        session: null,
        sessionRequested: false,
        unclaimedPlaceholderPlayerId: invites[0]?.placeholderPlayerId ?? null,
        otherSessionCount: others.length,
      });
      if (plan.ok) removePlaceholderPlayerId = plan.removePlaceholderPlayerId;
    }
    await deleteSessionFiles(session);
    await db.transaction(async (tx) => {
      await tx.delete(ballBoiSessionsTable).where(eq(ballBoiSessionsTable.id, sessionId));
      if (removePlaceholderPlayerId != null) {
        await tx.delete(playersTable).where(and(eq(playersTable.id, removePlaceholderPlayerId), isNull(playersTable.clerkUserId)));
      }
    });
    res.json({ removed: true, matchRemoved: removePlaceholderPlayerId != null });
  } catch (err) {
    logger.error({ err }, "Failed to remove a recording");
    res.status(500).json({ error: "Couldn't remove the recording. Try again." });
  }
});

/** Does this match need "[Name] agreed to be filmed." before recording? Pure, for tests. */
export function opponentAgreement(
  match: { player1Id: number; player2Id: number; player3Id: number | null; player4Id: number | null },
  myIds: Set<number>,
  players: Map<number, { name: string; clerkUserId: string | null }>,
): { inMatch: boolean; needsOpponentAgreement: boolean; opponentName: string | null } {
  const ids = [match.player1Id, match.player2Id, match.player3Id, match.player4Id].filter((id): id is number => id != null);
  const inMatch = ids.some((id) => myIds.has(id));
  const opponents = ids.filter((id) => !myIds.has(id)).map((id) => players.get(id)).filter((p) => p != null);
  // A placeholder is a player row nobody has claimed: they aren't on Ball Boi.
  const placeholder = opponents.find((p) => !p.clerkUserId);
  return {
    inMatch,
    needsOpponentAgreement: !!placeholder,
    opponentName: (placeholder ?? opponents[0])?.name ?? null,
  };
}

/**
 * GET /recording/matches/:matchId/filming
 * Before the camera opens: is the opponent someone who isn't on Ball Boi? If
 * so the ready screen asks the recorder to confirm "[Name] agreed to be
 * filmed." (spec decision 93, B10). The time they confirm goes on the
 * session's metadata as opponentAgreedAt.
 */
router.get("/recording/matches/:matchId/filming", requireAuth, async (req: Request, res: Response) => {
  const userId = getAuth(req).userId!;
  const matchId = Number(req.params.matchId);
  if (!Number.isInteger(matchId) || matchId <= 0) {
    res.status(400).json({ error: "Invalid match id" });
    return;
  }
  try {
    const [match] = await db.select().from(matchesTable).where(eq(matchesTable.id, matchId));
    if (!match) {
      res.status(404).json({ error: "This match isn't there anymore." });
      return;
    }
    const ids = [match.player1Id, match.player2Id, match.player3Id, match.player4Id].filter((id): id is number => id != null);
    const rows = await db
      .select({ id: playersTable.id, name: playersTable.name, clerkUserId: playersTable.clerkUserId })
      .from(playersTable)
      .where(inArray(playersTable.id, ids));
    const myIds = new Set(rows.filter((p) => p.clerkUserId === userId).map((p) => p.id));
    const result = opponentAgreement(match, myIds, new Map(rows.map((p) => [p.id, p])));
    if (!result.inMatch) {
      res.status(403).json({ error: "Only the players in this match can record it." });
      return;
    }
    res.json({ needsOpponentAgreement: result.needsOpponentAgreement, opponentName: result.opponentName });
  } catch (err) {
    logger.error({ err }, "Failed to check the opponent before recording");
    res.status(500).json({ error: "Couldn't load this match." });
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
    // Stop any half-sent upload in storage before the session goes.
    if (plan.deleteSessionId != null && sessions[0]) await deleteSessionFiles(sessions[0]);
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

type SidecarStore = Pick<ObjectStorageService, "putObject" | "getObject">;
let sidecarStore: SidecarStore | null = null;

/** Tests swap the store. */
export function setSidecarStoreForTests(store: SidecarStore | null) {
  sidecarStore = store;
}

/**
 * PUT /recording/sessions/:sessionId/sidecar
 * The recording's metadata sidecar (decision T5), from the phone that
 * recorded it. Stored in storage next to the video, one file per session; a
 * newer copy (after the court-line fix or the score prompt) replaces it.
 * Checked and cleaned first (lib/recordingSidecar.ts): no location, no names.
 */
router.put("/recording/sessions/:sessionId/sidecar", requireAuth, async (req: Request, res: Response) => {
  const userId = getAuth(req).userId!;
  const sessionId = Number(req.params.sessionId);
  if (!Number.isInteger(sessionId) || sessionId <= 0) {
    res.status(400).json({ error: "Invalid recording id" });
    return;
  }
  try {
    const [session] = await db.select().from(ballBoiSessionsTable).where(eq(ballBoiSessionsTable.id, sessionId));
    if (!session) {
      res.status(404).json({ error: "Recording not found" });
      return;
    }
    if (session.recordedByClerkUserId !== userId) {
      res.status(403).json({ error: "Only the player who recorded this can send its sidecar." });
      return;
    }
    const checked = checkSidecar(req.body, { matchId: session.matchId, sessionId });
    if (!checked.ok) {
      res.status(400).json({ error: checked.error });
      return;
    }
    const objectPath = sidecarObjectPath(session.matchId, sessionId);
    sidecarStore ??= new ObjectStorageService();
    await sidecarStore.putObject(objectPath, checked.json);
    const patch: Record<string, unknown> = { sidecarPath: objectPath, sidecarUpdatedAt: new Date().toISOString() };
    // Conditions at stop go on the session too (test plan section 3).
    const conditions = cleanConditions(checked.sidecar.conditions);
    if (conditions !== undefined) patch.conditions = conditions;
    await db
      .update(ballBoiSessionsTable)
      .set({ metadata: sql`coalesce(${ballBoiSessionsTable.metadata}, '{}'::jsonb) || ${JSON.stringify(patch)}::jsonb` })
      .where(eq(ballBoiSessionsTable.id, sessionId));
    res.json({ saved: true, objectPath });
  } catch (err) {
    logger.error({ err, sessionId }, "Failed to save a recording sidecar");
    res.status(500).json({ error: "Couldn't save the sidecar." });
  }
});

async function readStream(body: NodeJS.ReadableStream): Promise<string> {
  const chunks: Buffer[] = [];
  for await (const chunk of body) chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk as string));
  return Buffer.concat(chunks).toString("utf8");
}

/**
 * PUT /recording/matches/:matchId/conditions { conditions }
 * Conditions at stop from the score prompt (test plan section 3): indoor or
 * outdoor, day or night, surface. Optional; null clears them. Saved on the
 * recorder's sessions for this match and into their stored sidecars. The
 * phone also writes them into its own sidecar, so a recording still on the
 * phone sends them itself; this covers one that already uploaded.
 */
router.put("/recording/matches/:matchId/conditions", requireAuth, async (req: Request, res: Response) => {
  const userId = getAuth(req).userId!;
  const matchId = Number(req.params.matchId);
  const conditions = cleanConditions(req.body?.conditions);
  if (!Number.isInteger(matchId) || matchId <= 0 || conditions === undefined) {
    res.status(400).json({ error: "Send conditions: setting (indoor or outdoor), light (day or night), surface (hard, clay, grass or other), or null." });
    return;
  }
  try {
    const sessions = await db
      .select()
      .from(ballBoiSessionsTable)
      .where(and(eq(ballBoiSessionsTable.matchId, matchId), eq(ballBoiSessionsTable.recordedByClerkUserId, userId)));
    sidecarStore ??= new ObjectStorageService();
    for (const session of sessions) {
      await db
        .update(ballBoiSessionsTable)
        .set({ metadata: sql`coalesce(${ballBoiSessionsTable.metadata}, '{}'::jsonb) || ${JSON.stringify({ conditions })}::jsonb` })
        .where(eq(ballBoiSessionsTable.id, session.id));
      const m = (session.metadata as Record<string, unknown> | null) ?? {};
      if (typeof m.sidecarPath !== "string") continue;
      try {
        const stored = JSON.parse(await readStream((await sidecarStore.getObject(m.sidecarPath)).body)) as Record<string, unknown>;
        await sidecarStore.putObject(m.sidecarPath, JSON.stringify(withConditions(stored, conditions)));
      } catch (err) {
        // The session has them; the phone's next sidecar copy (if any) carries them too.
        logger.warn({ err, sessionId: session.id }, "Couldn't add conditions to a stored sidecar");
      }
    }
    res.json({ saved: true, recordings: sessions.length });
  } catch (err) {
    logger.error({ err, matchId }, "Failed to save recording conditions");
    res.status(500).json({ error: "Couldn't save the conditions." });
  }
});

export default router;
