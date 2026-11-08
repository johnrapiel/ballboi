import { Router, type Request, type Response, type NextFunction } from "express";
import { getAuth } from "@clerk/express";
import { db, leagueJoinRequestsTable, leagueRoundByesTable, leaguesTable, matchesTable, playersTable } from "@workspace/db";
import { and, desc, eq, inArray, isNull, or, sql } from "drizzle-orm";
import { todayFor } from "../lib/leagueCalendar.js";
import { getLeagueRole } from "../lib/leagueAccess.js";
import { approveOutcome, joinOutcome } from "../lib/leagueJoining.js";
import { ENDED_MESSAGE, leagueHasEnded, removeCheck } from "../lib/leagueLifecycle.js";
import { planDropout } from "../lib/playoffs.js";
import { walkover } from "../services/leaguePlayoffs.js";
import { SKILL_LEVELS } from "../lib/leagueSetup.js";
import { logger } from "../lib/logger.js";
import { loadProfiles, playerDisplayName, playerLevelText, playerProfileLevel, profileNameFor, type ProfileMap } from "../lib/playerProfile.js";
import { requireLeagueAdmin } from "../middlewares/requireLeagueAdmin.js";
import { sendPushToUsers } from "./notifications.js";

// Joining and leaving (spec: Leagues > Joining and leaving; Discover > Joining
// an Open league). Open leagues take requests that an admin approves; every
// league locks at the season start, with a waitlist for next season; a player
// who drops out keeps their played matches and the rest are voided.

function requireAuth(req: Request, res: Response, next: NextFunction) {
  const { userId } = getAuth(req);
  if (!userId) { res.status(401).json({ error: "Unauthorized" }); return; }
  next();
}

function parseLeagueId(req: Request): number | null {
  const id = parseInt(String(req.params.leagueId));
  return isNaN(id) ? null : id;
}

async function activePlayerCount(leagueId: number): Promise<number> {
  const rows = await db
    .select({ id: playersTable.id })
    .from(playersTable)
    .where(and(eq(playersTable.leagueId, leagueId), isNull(playersTable.leftAt)));
  return rows.length;
}

/**
 * A request as the admin sees it: the asker's current profile name and level
 * (A1, S6), falling back to what was saved with the request.
 */
function requestJson(r: typeof leagueJoinRequestsTable.$inferSelect, profiles: ProfileMap = new Map()) {
  const asker = { clerkUserId: r.clerkUserId, name: r.playerName, skillLevel: r.skillLevel };
  return {
    id: r.id,
    leagueId: r.leagueId,
    playerName: playerDisplayName(asker, profiles),
    skillLevel: playerLevelText(asker, profiles),
    rating: playerProfileLevel(asker, profiles),
    kind: r.kind,
    status: r.status,
    note: r.note ?? null,
    createdAt: r.createdAt.toISOString(),
  };
}

const router = Router();

/**
 * The signed-in player's requests to join: pending ones show as "Requested"
 * on the Leagues tab, declined ones as a one-line note until dismissed
 * (decision 30). Approved ones are already in the league.
 */
router.get("/me/join-requests", requireAuth, async (req, res) => {
  const { userId } = getAuth(req);
  const rows = await db
    .select({
      id: leagueJoinRequestsTable.id,
      leagueId: leagueJoinRequestsTable.leagueId,
      leagueName: leaguesTable.name,
      kind: leagueJoinRequestsTable.kind,
      status: leagueJoinRequestsTable.status,
      createdAt: leagueJoinRequestsTable.createdAt,
      decidedAt: leagueJoinRequestsTable.decidedAt,
    })
    .from(leagueJoinRequestsTable)
    .innerJoin(leaguesTable, eq(leaguesTable.id, leagueJoinRequestsTable.leagueId))
    .where(and(
      eq(leagueJoinRequestsTable.clerkUserId, userId!),
      or(
        eq(leagueJoinRequestsTable.status, "pending"),
        and(eq(leagueJoinRequestsTable.status, "declined"), isNull(leagueJoinRequestsTable.playerDismissedAt)),
      ),
    ))
    .orderBy(desc(leagueJoinRequestsTable.createdAt));
  res.json(
    rows.map((r) => ({
      ...r,
      createdAt: r.createdAt.toISOString(),
      decidedAt: r.decidedAt ? r.decidedAt.toISOString() : null,
    })),
  );
});

/** Dismiss the "declined" note for one request. */
router.post("/me/join-requests/:requestId/dismiss", requireAuth, async (req, res) => {
  const { userId } = getAuth(req);
  const requestId = parseInt(String(req.params.requestId));
  if (isNaN(requestId)) { res.status(400).json({ error: "Invalid request ID" }); return; }
  await db
    .update(leagueJoinRequestsTable)
    .set({ playerDismissedAt: new Date() })
    .where(and(eq(leagueJoinRequestsTable.id, requestId), eq(leagueJoinRequestsTable.clerkUserId, userId!)));
  res.status(204).send();
});

/** Ask to join an Open league from Discover. */
router.post("/leagues/:leagueId/join-requests", requireAuth, async (req, res) => {
  const { userId } = getAuth(req);
  const leagueId = parseLeagueId(req);
  if (leagueId === null) { res.status(400).json({ error: "Invalid league ID" }); return; }
  const sentName = typeof req.body?.playerName === "string" ? req.body.playerName.trim() : "";
  const profiles = await loadProfiles([userId]);
  // The profile's name and level win over anything the app sends (A1).
  const playerName = profiles.get(userId!)?.displayName?.trim() || sentName;
  if (!playerName) { res.status(400).json({ error: "Your name is required" }); return; }
  const sentLevel = (SKILL_LEVELS as readonly string[]).includes(req.body?.skillLevel) ? String(req.body.skillLevel) : "3.0";
  const skillLevel = playerLevelText({ clerkUserId: userId, skillLevel: sentLevel }, profiles);

  const [league] = await db.select().from(leaguesTable).where(eq(leaguesTable.id, leagueId));
  if (!league) { res.status(404).json({ error: "League not found" }); return; }
  // Q8: nothing to ask for once a league has ended.
  if (leagueHasEnded(league)) { res.status(410).json({ error: ENDED_MESSAGE, code: "league_ended" }); return; }

  const [member] = await db
    .select({ id: playersTable.id })
    .from(playersTable)
    .where(and(eq(playersTable.leagueId, leagueId), eq(playersTable.clerkUserId, userId!), isNull(playersTable.leftAt)));
  if (member) { res.status(409).json({ error: "You're already in this league" }); return; }

  const [pending] = await db
    .select()
    .from(leagueJoinRequestsTable)
    .where(and(
      eq(leagueJoinRequestsTable.leagueId, leagueId),
      eq(leagueJoinRequestsTable.clerkUserId, userId!),
      eq(leagueJoinRequestsTable.status, "pending"),
    ));
  if (pending) { res.status(200).json(requestJson(pending, profiles)); return; }

  const outcome = joinOutcome({
    league,
    activePlayerCount: await activePlayerCount(leagueId),
    today: todayFor(league),
    via: "request",
    skillLevel,
  });
  if (outcome.kind === "refuse") { res.status(outcome.status).json({ error: outcome.error }); return; }

  const kind = outcome.kind === "waitlist" ? "waitlist" : "request";
  // An optional note to the organizer, from Discover's "Request a spot".
  const note = typeof req.body?.note === "string" ? req.body.note.trim().slice(0, 300) || null : null;
  const [created] = await db
    .insert(leagueJoinRequestsTable)
    .values({ leagueId, clerkUserId: userId!, playerName, skillLevel, kind, note })
    .onConflictDoNothing()
    .returning();
  if (!created) { res.status(409).json({ error: "You already asked to join this league" }); return; }

  res.status(kind === "waitlist" ? 202 : 201).json({
    ...requestJson(created, profiles),
    message: outcome.kind === "waitlist" ? outcome.reason : "Request sent. The league's admin will approve it.",
  });
});

/** The signed-in user's own pending request or waitlist spot, if any. */
router.get("/leagues/:leagueId/join-requests/me", requireAuth, async (req, res) => {
  const { userId } = getAuth(req);
  const leagueId = parseLeagueId(req);
  if (leagueId === null) { res.status(400).json({ error: "Invalid league ID" }); return; }
  const [pending] = await db
    .select()
    .from(leagueJoinRequestsTable)
    .where(and(
      eq(leagueJoinRequestsTable.leagueId, leagueId),
      eq(leagueJoinRequestsTable.clerkUserId, userId!),
      eq(leagueJoinRequestsTable.status, "pending"),
    ));
  res.json(pending ? requestJson(pending) : null);
});

/** Withdraw your own request or leave the waitlist. */
router.delete("/leagues/:leagueId/join-requests/me", requireAuth, async (req, res) => {
  const { userId } = getAuth(req);
  const leagueId = parseLeagueId(req);
  if (leagueId === null) { res.status(400).json({ error: "Invalid league ID" }); return; }
  await db
    .update(leagueJoinRequestsTable)
    .set({ status: "withdrawn", decidedAt: new Date() })
    .where(and(
      eq(leagueJoinRequestsTable.leagueId, leagueId),
      eq(leagueJoinRequestsTable.clerkUserId, userId!),
      eq(leagueJoinRequestsTable.status, "pending"),
    ));
  res.status(204).send();
});

/** Admins: pending requests and the waitlist, oldest first. */
router.get("/leagues/:leagueId/join-requests", requireLeagueAdmin, async (_req, res) => {
  const leagueId = res.locals.leagueId as number;
  const rows = await db
    .select()
    .from(leagueJoinRequestsTable)
    .where(and(eq(leagueJoinRequestsTable.leagueId, leagueId), eq(leagueJoinRequestsTable.status, "pending")))
    .orderBy(leagueJoinRequestsTable.createdAt);
  const profiles = await loadProfiles(rows.map((r) => r.clerkUserId));
  res.json(rows.map((r) => requestJson(r, profiles)));
});

async function loadPendingRequest(leagueId: number, requestId: number) {
  const [row] = await db
    .select()
    .from(leagueJoinRequestsTable)
    .where(and(eq(leagueJoinRequestsTable.id, requestId), eq(leagueJoinRequestsTable.leagueId, leagueId)));
  return row;
}

/** Admins: approve a request. Open leagues: before the season starts. Private: any time (decision 30). */
router.post("/leagues/:leagueId/join-requests/:requestId/approve", requireLeagueAdmin, async (req, res) => {
  const { userId } = getAuth(req);
  const leagueId = res.locals.leagueId as number;
  const requestId = parseInt(String(req.params.requestId));
  if (isNaN(requestId)) { res.status(400).json({ error: "Invalid request ID" }); return; }

  const [league] = await db.select().from(leaguesTable).where(eq(leaguesTable.id, leagueId));
  const request = await loadPendingRequest(leagueId, requestId);
  if (!league || !request) { res.status(404).json({ error: "Request not found" }); return; }

  const outcome = approveOutcome({
    league,
    activePlayerCount: await activePlayerCount(leagueId),
    today: todayFor(league),
    request,
  });
  if (!outcome.ok) {
    if (outcome.moveToWaitlist) {
      await db.update(leagueJoinRequestsTable).set({ kind: "waitlist" }).where(eq(leagueJoinRequestsTable.id, requestId));
    }
    res.status(outcome.status).json({ error: outcome.error });
    return;
  }

  const playerName = await profileNameFor(request.clerkUserId, request.playerName);
  const player = await db.transaction(async (tx) => {
    const [decided] = await tx
      .update(leagueJoinRequestsTable)
      .set({ status: "approved", decidedAt: new Date(), decidedByClerkUserId: userId! })
      .where(and(eq(leagueJoinRequestsTable.id, requestId), eq(leagueJoinRequestsTable.status, "pending")))
      .returning();
    if (!decided) return null;
    const [existing] = await tx
      .select()
      .from(playersTable)
      .where(and(eq(playersTable.leagueId, leagueId), eq(playersTable.clerkUserId, request.clerkUserId)));
    if (existing) {
      const [back] = await tx
        .update(playersTable)
        .set({ leftAt: null, name: playerName })
        .where(eq(playersTable.id, existing.id))
        .returning();
      return back;
    }
    const [created] = await tx
      .insert(playersTable)
      .values({
        name: playerName,
        clerkUserId: request.clerkUserId,
        leagueId,
        skillLevel: request.skillLevel,
        wins: 0,
        losses: 0,
      })
      .returning();
    return created;
  });
  if (!player) { res.status(409).json({ error: "This request was already handled." }); return; }

  sendPushToUsers([request.clerkUserId], "You're in", `You've joined ${league.name}.`, `/league/${leagueId}`).catch(() => {});
  res.status(201).json({ id: player.id, name: player.name, leagueId });
});

/** Admins: decline a request or remove someone from the waitlist. */
router.post("/leagues/:leagueId/join-requests/:requestId/decline", requireLeagueAdmin, async (req, res) => {
  const { userId } = getAuth(req);
  const leagueId = res.locals.leagueId as number;
  const requestId = parseInt(String(req.params.requestId));
  if (isNaN(requestId)) { res.status(400).json({ error: "Invalid request ID" }); return; }
  const [decided] = await db
    .update(leagueJoinRequestsTable)
    .set({ status: "declined", decidedAt: new Date(), decidedByClerkUserId: userId! })
    .where(and(
      eq(leagueJoinRequestsTable.id, requestId),
      eq(leagueJoinRequestsTable.leagueId, leagueId),
      eq(leagueJoinRequestsTable.status, "pending"),
    ))
    .returning();
  if (!decided) { res.status(404).json({ error: "Request not found" }); return; }
  res.status(204).send();
});

/**
 * Take a player out of the league (decision 27): their played matches stay,
 * their remaining weekly matches and byes are voided, and they leave
 * standings and pairings. A playoff match still to play goes to the opponent
 * on a walkover (Q5), so the bracket keeps moving. Returns how many matches
 * were voided.
 */
async function dropOut(leagueId: number, playerId: number, playerName: string): Promise<number> {
  const plan = await db.transaction(async (tx) => {
    const [theirs, active] = await Promise.all([
      tx
        .select()
        .from(matchesTable)
        .where(and(
          eq(matchesTable.leagueId, leagueId),
          or(
            eq(matchesTable.player1Id, playerId),
            eq(matchesTable.player2Id, playerId),
            eq(matchesTable.player3Id, playerId),
            eq(matchesTable.player4Id, playerId),
          ),
        )),
      tx
        .select({ id: playersTable.id })
        .from(playersTable)
        .where(and(eq(playersTable.leagueId, leagueId), isNull(playersTable.leftAt))),
    ]);
    const stillIn = new Set(active.map((p) => p.id).filter((id) => id !== playerId));
    const out = planDropout(theirs, playerId, (id) => stillIn.has(id));
    if (out.voidIds.length) {
      await tx.update(matchesTable).set({ voidedAt: new Date(), status: "voided" }).where(inArray(matchesTable.id, out.voidIds));
    }
    await tx.delete(leagueRoundByesTable).where(eq(leagueRoundByesTable.playerId, playerId));
    await tx.update(playersTable).set({ leftAt: sql`now()` }).where(eq(playersTable.id, playerId));
    return { ...out, matches: theirs };
  });
  const voided = plan.voidIds;

  // Q5: the opponent moves on in the bracket, shown as W/O.
  for (const w of plan.walkovers) {
    const match = plan.matches.find((m) => m.id === w.matchId)!;
    try {
      if (await walkover(match, w.winnerId)) {
        const [winner] = await db.select({ clerkUserId: playersTable.clerkUserId }).from(playersTable).where(eq(playersTable.id, w.winnerId));
        if (winner?.clerkUserId) {
          sendPushToUsers([winner.clerkUserId], "Walkover", `${playerName} left the league, so you win your playoff match on a walkover.`, `/league/${leagueId}`)
            .catch(() => {});
        }
      }
    } catch (err) {
      logger.error({ err, leagueId, matchId: w.matchId }, "Couldn't give a playoff walkover");
    }
  }

  // Tell the opponents whose matches were cancelled.
  if (voided.length) {
    const rows = await db.select().from(matchesTable).where(inArray(matchesTable.id, voided));
    const opponentIds = [...new Set(rows.flatMap((m) => [m.player1Id, m.player2Id, m.player3Id, m.player4Id]))]
      .filter((id): id is number => id != null && id !== playerId);
    if (opponentIds.length) {
      const opponents = await db
        .select({ clerkUserId: playersTable.clerkUserId })
        .from(playersTable)
        .where(inArray(playersTable.id, opponentIds));
      const ids = opponents.map((o) => o.clerkUserId).filter((id): id is string => !!id);
      sendPushToUsers(ids, "Match cancelled", `${playerName} left the league, so your match is cancelled.`, `/league/${leagueId}`)
        .catch((err) => logger.error({ err, leagueId }, "Couldn't send dropout notifications"));
    }
  }
  return voided.length;
}

/** Leave a league you play in. */
router.post("/leagues/:leagueId/leave", requireAuth, async (req, res) => {
  const { userId } = getAuth(req);
  const leagueId = parseLeagueId(req);
  if (leagueId === null) { res.status(400).json({ error: "Invalid league ID" }); return; }
  const [player] = await db
    .select()
    .from(playersTable)
    .where(and(eq(playersTable.leagueId, leagueId), eq(playersTable.clerkUserId, userId!), isNull(playersTable.leftAt)));
  if (!player) { res.status(404).json({ error: "You're not playing in this league" }); return; }
  // Q4: an admin who leaves stops playing but still runs the league, so even
  // the only admin can leave. Their admin role isn't touched.
  const voidedMatches = await dropOut(leagueId, player.id, player.name);
  const stillAdmin = (await getLeagueRole(leagueId, userId!)) !== null;
  res.json({ left: true, voidedMatches, stillAdmin });
});

/** Admins: remove a player. Same rules as leaving. */
router.post("/leagues/:leagueId/players/:playerId/remove", requireLeagueAdmin, async (req, res) => {
  const leagueId = res.locals.leagueId as number;
  const playerId = parseInt(String(req.params.playerId));
  if (isNaN(playerId)) { res.status(400).json({ error: "Invalid player ID" }); return; }
  const [player] = await db
    .select()
    .from(playersTable)
    .where(and(eq(playersTable.id, playerId), eq(playersTable.leagueId, leagueId), isNull(playersTable.leftAt)));
  if (!player) { res.status(404).json({ error: "That player isn't in this league" }); return; }
  // C26: taking yourself out goes through Leave, with its own rules and alert.
  const self = removeCheck({ playerClerkUserId: player.clerkUserId, callerClerkUserId: getAuth(req).userId ?? null });
  if (!self.ok) { res.status(self.status).json({ error: self.error }); return; }
  const voidedMatches = await dropOut(leagueId, player.id, player.name);
  if (player.clerkUserId) {
    const [league] = await db.select({ name: leaguesTable.name }).from(leaguesTable).where(eq(leaguesTable.id, leagueId));
    sendPushToUsers([player.clerkUserId], "Removed from league", `An admin removed you from ${league?.name ?? "a league"}.`, "/leagues")
      .catch(() => {});
  }
  res.json({ removed: true, voidedMatches });
});

export default router;
