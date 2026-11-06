import { Router, type IRouter, type NextFunction, type Request, type Response } from "express";
import { getAuth } from "@clerk/express";
import {
  ballBoiSessionsTable,
  db,
  matchesTable,
  matchInvitesTable,
  playersTable,
  recordingConsentTable,
  usersTable,
} from "@workspace/db";
import { and, eq, inArray, isNull, ne, or } from "drizzle-orm";
import pino from "pino";
import { blockedAccountsFor } from "../lib/blocks";
import { DrizzlePlayerSearchRepo } from "../lib/playerSearchRepo";
import { flipScore, inviteUrl, newInviteCode, parseQuickMatch, parseSideScore, pickableOpponents } from "../lib/quickMatch";

// Quick match: record a casual hit or a match outside a league, against a
// league mate, a past opponent, or someone not on Ball Boi yet (a
// placeholder with an invite link). Spec: Ball Boi > Recording.

const logger = pino({ name: "quickMatch" });
const router: IRouter = Router();

function requireAuth(req: Request, res: Response, next: NextFunction) {
  if (!getAuth(req).userId) {
    res.status(401).json({ error: "Unauthorized" });
    return;
  }
  next();
}

/** League mates and past opponents with accounts, for the caller. */
async function opponentsFor(userId: string) {
  const mine = await db
    .select({ id: playersTable.id, leagueId: playersTable.leagueId })
    .from(playersTable)
    .where(eq(playersTable.clerkUserId, userId));
  if (mine.length === 0) return [];
  const myIds = mine.map((p) => p.id);
  const leagueIds = [...new Set(mine.map((p) => p.leagueId).filter((id): id is number => id != null))];
  const [mates, played, blocked] = await Promise.all([
    leagueIds.length
      ? db
          .select({ id: playersTable.id, name: playersTable.name, clerkUserId: playersTable.clerkUserId })
          .from(playersTable)
          .where(inArray(playersTable.leagueId, leagueIds))
      : Promise.resolve([]),
    db
      .select({ p1: matchesTable.player1Id, p2: matchesTable.player2Id, p3: matchesTable.player3Id, p4: matchesTable.player4Id })
      .from(matchesTable)
      .where(
        or(
          inArray(matchesTable.player1Id, myIds),
          inArray(matchesTable.player2Id, myIds),
          inArray(matchesTable.player3Id, myIds),
          inArray(matchesTable.player4Id, myIds),
        ),
      ),
    blockedAccountsFor(userId),
  ]);
  const pastIds = [
    ...new Set(played.flatMap((m) => [m.p1, m.p2, m.p3, m.p4]).filter((id): id is number => id != null && !myIds.includes(id))),
  ];
  const past = pastIds.length
    ? await db
        .select({ id: playersTable.id, name: playersTable.name, clerkUserId: playersTable.clerkUserId })
        .from(playersTable)
        .where(inArray(playersTable.id, pastIds))
    : [];
  return pickableOpponents([...mates, ...past], userId, blocked);
}

/** GET /recording/opponents: who you can pick for a Quick match. */
router.get("/recording/opponents", requireAuth, async (req: Request, res: Response) => {
  try {
    res.json(await opponentsFor(getAuth(req).userId!));
  } catch (err) {
    logger.error({ err }, "Failed to list Quick match opponents");
    res.status(500).json({ error: "Couldn't load players." });
  }
});

const playerSearch = new DrizzlePlayerSearchRepo();

/**
 * Someone picked from player search (findings #15 and #18), by users.id:
 * anyone findable, or a league mate or past opponent, never blocked either
 * way. Uses their league-free player row, making one if they have none, so a
 * casual match never lands on a league roster row it doesn't need.
 */
async function searchedOpponent(me: string, userId: number): Promise<{ playerId: number; name: string } | null> {
  let found = await playerSearch.findableUser(me, userId);
  if (!found) {
    const [connected, blocked] = await Promise.all([playerSearch.connected(me), playerSearch.blocked(me)]);
    found = connected.find((c) => c.userId === userId && c.clerkUserId !== me && !blocked.has(c.clerkUserId)) ?? null;
  }
  if (!found) return null;
  if (found.playerId != null) return { playerId: found.playerId, name: found.name };
  const [created] = await db
    .insert(playersTable)
    .values({ name: found.name, clerkUserId: found.clerkUserId })
    .returning({ id: playersTable.id });
  return { playerId: created.id, name: found.name };
}

/** The caller's player row for a Quick match: an existing one, or a new one. */
async function myPlayerId(userId: string): Promise<{ id: number; name: string }> {
  const rows = await db
    .select({ id: playersTable.id, name: playersTable.name, leagueId: playersTable.leagueId })
    .from(playersTable)
    .where(eq(playersTable.clerkUserId, userId));
  const best = rows.find((r) => r.leagueId == null) ?? rows[0];
  if (best) return { id: best.id, name: best.name };
  const [user] = await db.select({ displayName: usersTable.displayName }).from(usersTable).where(eq(usersTable.clerkUserId, userId));
  const [created] = await db
    .insert(playersTable)
    .values({ name: user?.displayName ?? "Player", clerkUserId: userId })
    .returning({ id: playersTable.id, name: playersTable.name });
  return created;
}

/**
 * POST /recording/quick-matches { format, opponentPlayerId }, { format, opponentUserId } or { format, opponentName }
 * Creates a match outside any league, starting now. A typed name becomes a
 * placeholder player with an invite link. Returns the match and the link.
 */
router.post("/recording/quick-matches", requireAuth, async (req: Request, res: Response) => {
  const userId = getAuth(req).userId!;
  const parsed = parseQuickMatch(req.body);
  if (!parsed.ok) {
    res.status(400).json({ error: parsed.error });
    return;
  }
  try {
    const me = await myPlayerId(userId);
    const now = new Date().toISOString();

    if (parsed.opponentPlayerId != null) {
      const allowed = await opponentsFor(userId);
      const opponent = allowed.find((o) => o.playerId === parsed.opponentPlayerId);
      if (!opponent) {
        res.status(404).json({ error: "Pick someone from your leagues or past matches." });
        return;
      }
      const [match] = await db
        .insert(matchesTable)
        .values({ player1Id: me.id, player2Id: opponent.playerId, scheduledAt: now, status: "scheduled", generatedFrom: "quick_match" })
        .returning({ id: matchesTable.id });
      res.status(201).json({ matchId: match.id, opponentName: opponent.name, invite: null });
      return;
    }

    if (parsed.opponentUserId != null) {
      const opponent = await searchedOpponent(userId, parsed.opponentUserId);
      if (!opponent) {
        res.status(404).json({ error: "This player isn't available. Search again, or add someone not on Ball Boi." });
        return;
      }
      const [match] = await db
        .insert(matchesTable)
        .values({ player1Id: me.id, player2Id: opponent.playerId, scheduledAt: now, status: "scheduled", generatedFrom: "quick_match" })
        .returning({ id: matchesTable.id });
      res.status(201).json({ matchId: match.id, opponentName: opponent.name, invite: null });
      return;
    }

    const code = newInviteCode();
    const result = await db.transaction(async (tx) => {
      const [placeholder] = await tx
        .insert(playersTable)
        .values({ name: parsed.opponentName! })
        .returning({ id: playersTable.id });
      const [match] = await tx
        .insert(matchesTable)
        .values({ player1Id: me.id, player2Id: placeholder.id, scheduledAt: now, status: "scheduled", generatedFrom: "quick_match" })
        .returning({ id: matchesTable.id });
      await tx.insert(matchInvitesTable).values({
        code,
        matchId: match.id,
        placeholderPlayerId: placeholder.id,
        createdByClerkUserId: userId,
      });
      return { matchId: match.id };
    });
    res.status(201).json({
      matchId: result.matchId,
      opponentName: parsed.opponentName,
      invite: { code, url: inviteUrl(code) },
    });
  } catch (err) {
    logger.error({ err }, "Failed to create a Quick match");
    res.status(500).json({ error: "Couldn't start the match. Try again." });
  }
});

/**
 * POST /recording/quick-matches/:matchId/score { score }
 * The post-stop score prompt for a Quick match. Written from the caller's
 * side ("6-3, 6-4" means they won both sets). The first score entered
 * stands. Quick matches have no league, so nothing here touches standings
 * or league win-loss records. League matches use Session C's
 * POST /leagues/:leagueId/matches/:matchId/score instead.
 */
router.post("/recording/quick-matches/:matchId/score", requireAuth, async (req: Request, res: Response) => {
  const userId = getAuth(req).userId!;
  const matchId = Number(req.params.matchId);
  if (!Number.isInteger(matchId) || matchId <= 0) {
    res.status(400).json({ error: "Invalid match id" });
    return;
  }
  const parsed = parseSideScore(req.body?.score);
  if (!parsed.ok) {
    res.status(400).json({ error: parsed.error });
    return;
  }
  try {
    const [match] = await db.select().from(matchesTable).where(eq(matchesTable.id, matchId));
    if (!match || match.leagueId != null) {
      res.status(404).json({ error: "Match not found" });
      return;
    }
    const mine = await db.select({ id: playersTable.id }).from(playersTable).where(eq(playersTable.clerkUserId, userId));
    const myIds = new Set(mine.map((p) => p.id));
    const side: 1 | 2 | null = myIds.has(match.player1Id) ? 1 : myIds.has(match.player2Id) ? 2 : null;
    if (!side) {
      res.status(403).json({ error: "Only the players in this match can enter its score." });
      return;
    }
    // Stored from player 1's side, like every other match.
    const stored = side === 1 ? parsed.score : flipScore(parsed.score);
    const winnerSide = side === 1 ? parsed.winnerSide : parsed.winnerSide === 1 ? 2 : 1;
    const now = new Date().toISOString();
    const [saved] = await db
      .update(matchesTable)
      .set({
        status: "completed",
        score: stored,
        winnerId: winnerSide === 1 ? match.player1Id : match.player2Id,
        completedAt: now,
        recordedAt: now,
        recordedByClerkUserId: userId,
      })
      .where(and(eq(matchesTable.id, matchId), ne(matchesTable.status, "completed")))
      .returning({ id: matchesTable.id });
    if (!saved) {
      res.status(409).json({ error: "A score is already in for this match. The first score entered stands." });
      return;
    }
    res.json({ matchId, score: parsed.score });
  } catch (err) {
    logger.error({ err }, "Failed to save a Quick match score");
    res.status(500).json({ error: "Couldn't save the score. Try again." });
  }
});

/**
 * POST /recording/quick-matches/:matchId/abandon
 * Leaving a Quick match before recording it: closing the invite screen or
 * the camera (John's decision Q18). The match only existed for that
 * recording, so it goes, with its placeholder opponent and invite. Only the
 * player who started it can, and only while nothing is recorded or scored.
 */
router.post("/recording/quick-matches/:matchId/abandon", requireAuth, async (req: Request, res: Response) => {
  const userId = getAuth(req).userId!;
  const matchId = Number(req.params.matchId);
  if (!Number.isInteger(matchId) || matchId <= 0) {
    res.status(400).json({ error: "Invalid match id" });
    return;
  }
  try {
    const [match] = await db.select().from(matchesTable).where(eq(matchesTable.id, matchId));
    if (!match) {
      res.json({ removed: true });
      return;
    }
    if (match.leagueId != null || match.generatedFrom !== "quick_match") {
      res.status(409).json({ error: "Only a Quick match can be removed this way." });
      return;
    }
    const mine = await db.select({ id: playersTable.id }).from(playersTable).where(eq(playersTable.clerkUserId, userId));
    if (!mine.some((p) => p.id === match.player1Id)) {
      res.status(403).json({ error: "Only the player who started this match can remove it." });
      return;
    }
    const [sessions, invites] = await Promise.all([
      db.select({ id: ballBoiSessionsTable.id }).from(ballBoiSessionsTable).where(eq(ballBoiSessionsTable.matchId, matchId)),
      db
        .select({ placeholderPlayerId: matchInvitesTable.placeholderPlayerId })
        .from(matchInvitesTable)
        .where(and(eq(matchInvitesTable.matchId, matchId), isNull(matchInvitesTable.claimedByClerkUserId))),
    ]);
    if (match.score || match.status === "completed" || sessions.length > 0) {
      res.status(409).json({ error: "This match has a recording or a score, so it stays." });
      return;
    }
    await db.transaction(async (tx) => {
      await tx.delete(matchesTable).where(eq(matchesTable.id, matchId));
      const placeholder = invites[0]?.placeholderPlayerId;
      // The placeholder existed only for this match; its invite goes with the match.
      if (placeholder != null) {
        await tx.delete(playersTable).where(and(eq(playersTable.id, placeholder), isNull(playersTable.clerkUserId)));
      }
    });
    res.json({ removed: true });
  } catch (err) {
    logger.error({ err }, "Failed to remove an abandoned Quick match");
    res.status(500).json({ error: "Couldn't remove the match." });
  }
});

/**
 * GET /recording/invites/:code
 * What the person opening an invite link sees: who recorded the match, when,
 * and the name they were entered under.
 */
router.get("/recording/invites/:code", requireAuth, async (req: Request, res: Response) => {
  const code = String(req.params.code).toUpperCase();
  try {
    const [invite] = await db.select().from(matchInvitesTable).where(eq(matchInvitesTable.code, code));
    if (!invite) {
      res.status(404).json({ error: "This invite link isn't valid." });
      return;
    }
    const [match] = await db.select().from(matchesTable).where(eq(matchesTable.id, invite.matchId));
    const recorderPlayerId = match && match.player1Id !== invite.placeholderPlayerId ? match.player1Id : match?.player2Id;
    const players = await db
      .select({ id: playersTable.id, name: playersTable.name })
      .from(playersTable)
      .where(inArray(playersTable.id, [invite.placeholderPlayerId, recorderPlayerId ?? invite.placeholderPlayerId]));
    const name = (id: number | undefined) => players.find((p) => p.id === id)?.name ?? "A player";
    res.json({
      code,
      recorderName: name(recorderPlayerId),
      yourName: name(invite.placeholderPlayerId),
      recordedAt: (match?.scheduledAt ?? invite.createdAt.toISOString()),
      claimed: invite.claimedByClerkUserId != null,
      claimedByYou: invite.claimedByClerkUserId === getAuth(req).userId,
      isYourInvite: invite.createdByClerkUserId === getAuth(req).userId,
    });
  } catch (err) {
    logger.error({ err }, "Failed to read a match invite");
    res.status(500).json({ error: "Couldn't load this invite." });
  }
});

/**
 * POST /recording/invites/:code/claim { trainingEnabled }
 * Attaches the placeholder to the caller's account, so the match is theirs
 * too, and saves their training choice before the match attaches.
 */
router.post("/recording/invites/:code/claim", requireAuth, async (req: Request, res: Response) => {
  const userId = getAuth(req).userId!;
  const code = String(req.params.code).toUpperCase();
  const trainingEnabled = req.body?.trainingEnabled;
  if (typeof trainingEnabled !== "boolean") {
    res.status(400).json({ error: "trainingEnabled must be true or false." });
    return;
  }
  try {
    const [invite] = await db.select().from(matchInvitesTable).where(eq(matchInvitesTable.code, code));
    if (!invite) {
      res.status(404).json({ error: "This invite link isn't valid." });
      return;
    }
    if (invite.createdByClerkUserId === userId) {
      res.status(400).json({ error: "This is your own invite. Send it to the player you recorded." });
      return;
    }
    const [user] = await db.select({ displayName: usersTable.displayName }).from(usersTable).where(eq(usersTable.clerkUserId, userId));
    const claimed = await db.transaction(async (tx) => {
      // Only the first person to open the link gets the match.
      const [row] = await tx
        .update(matchInvitesTable)
        .set({ claimedByClerkUserId: userId, claimedAt: new Date() })
        .where(and(eq(matchInvitesTable.code, code), isNull(matchInvitesTable.claimedByClerkUserId)))
        .returning();
      if (!row) return null;
      await tx
        .update(playersTable)
        .set({ clerkUserId: userId, ...(user?.displayName ? { name: user.displayName } : {}) })
        .where(and(eq(playersTable.id, row.placeholderPlayerId), isNull(playersTable.clerkUserId)));
      await tx
        .insert(recordingConsentTable)
        .values({ clerkUserId: userId, trainingEnabled })
        .onConflictDoUpdate({ target: recordingConsentTable.clerkUserId, set: { trainingEnabled, updatedAt: new Date() } });
      return row;
    });
    if (!claimed) {
      res.status(409).json({ error: "Someone already joined this match with this link." });
      return;
    }
    res.json({ matchId: claimed.matchId });
  } catch (err) {
    logger.error({ err }, "Failed to claim a match invite");
    res.status(500).json({ error: "Couldn't add the match. Try again." });
  }
});

export default router;
