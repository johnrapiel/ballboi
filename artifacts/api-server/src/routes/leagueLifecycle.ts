import { Router, type NextFunction, type Request, type Response } from "express";
import { getAuth } from "@clerk/express";
import {
  ballBoiSessionsTable,
  db,
  leagueAdminsTable,
  leagueNoticesTable,
  leagueRoundsTable,
  leaguesTable,
  matchesTable,
  playersTable,
} from "@workspace/db";
import { and, desc, eq, inArray, isNull } from "drizzle-orm";
import { deletedNotice, deleteNameMatches, splitMatchesForDelete } from "../lib/leagueLifecycle.js";
import { requireLeagueAdmin } from "../middlewares/requireLeagueAdmin.js";

// Ending and deleting a league (Oct 31 review, C9 and C10; decision 31), and
// the one-line notes players get when a league they were in is deleted.

function requireAuth(req: Request, res: Response, next: NextFunction) {
  if (!getAuth(req).userId) { res.status(401).json({ error: "Unauthorized" }); return; }
  next();
}

import { leagueChat } from "../messaging/leagueChatEvents.js";
const router = Router();

/** C9: end the league. Standings freeze, unpublished rounds are cancelled, history stays. */
router.post("/leagues/:leagueId/end", requireLeagueAdmin, async (_req, res) => {
  const leagueId = res.locals.leagueId as number;
  const [league] = await db.select().from(leaguesTable).where(eq(leaguesTable.id, leagueId));
  if (!league) { res.status(404).json({ error: "League not found" }); return; }
  if (league.endedAt) { res.status(409).json({ error: "This league has already ended." }); return; }

  const endedAt = new Date();
  const cancelledRounds = await db.transaction(async (tx) => {
    const drafts = await tx
      .select({ id: leagueRoundsTable.id })
      .from(leagueRoundsTable)
      .where(and(eq(leagueRoundsTable.leagueId, leagueId), isNull(leagueRoundsTable.publishedAt)));
    const draftIds = drafts.map((r) => r.id);
    if (draftIds.length) {
      // Draft pairings were never sent to players, so nothing about them is history.
      await tx.delete(matchesTable).where(and(eq(matchesTable.leagueId, leagueId), inArray(matchesTable.roundId, draftIds)));
      await tx.delete(leagueRoundsTable).where(inArray(leagueRoundsTable.id, draftIds));
    }
    await tx.update(leaguesTable).set({ status: "completed", endedAt }).where(eq(leaguesTable.id, leagueId));
    return draftIds.length;
  });

  // Its chat stays readable but takes no new messages (decision 145).
  leagueChat.leagueChanged(leagueId);
  res.json({ leagueId, status: "completed", endedAt: endedAt.toISOString(), cancelledRounds });
});

/**
 * C10: delete the league, with its name typed to confirm. Its rounds and
 * matches go, and every member gets a note. Matches with a Ball Boi recording
 * stay, detached from the league: those stats belong to the players.
 */
router.delete("/leagues/:leagueId", requireLeagueAdmin, async (req, res) => {
  const { userId } = getAuth(req);
  const leagueId = res.locals.leagueId as number;
  const [league] = await db.select().from(leaguesTable).where(eq(leaguesTable.id, leagueId));
  if (!league) { res.status(404).json({ error: "League not found" }); return; }
  if (!deleteNameMatches(req.body?.confirmName, league.name)) {
    res.status(400).json({ error: `Type ${league.name} to delete it.` });
    return;
  }

  const [players, admins, matches] = await Promise.all([
    db.select({ id: playersTable.id, clerkUserId: playersTable.clerkUserId, leftAt: playersTable.leftAt }).from(playersTable).where(eq(playersTable.leagueId, leagueId)),
    db.select({ clerkUserId: leagueAdminsTable.clerkUserId }).from(leagueAdminsTable).where(eq(leagueAdminsTable.leagueId, leagueId)),
    db.select({ id: matchesTable.id }).from(matchesTable).where(eq(matchesTable.leagueId, leagueId)),
  ]);
  const matchIds = matches.map((m) => m.id);
  const recorded = matchIds.length
    ? await db.select({ matchId: ballBoiSessionsTable.matchId }).from(ballBoiSessionsTable).where(inArray(ballBoiSessionsTable.matchId, matchIds))
    : [];
  const { remove, keep } = splitMatchesForDelete(matchIds, new Set(recorded.map((r) => r.matchId)));

  // Everyone in it this season, and the other admins; not the person deleting it.
  const members = [
    ...new Set(
      [...players.filter((p) => !p.leftAt).map((p) => p.clerkUserId), ...admins.map((a) => a.clerkUserId), league.createdByClerkUserId].filter(
        (id): id is string => !!id && id !== userId,
      ),
    ),
  ];

  await db.transaction(async (tx) => {
    if (remove.length) await tx.delete(matchesTable).where(inArray(matchesTable.id, remove));
    if (keep.length) {
      await tx
        .update(matchesTable)
        .set({ leagueId: null, roundId: null, playoffBracketId: null, playoffRound: null, playoffSlot: null })
        .where(inArray(matchesTable.id, keep));
    }
    // Player rows stay for any kept recording's stats; they're out of the league.
    await tx.update(playersTable).set({ leftAt: new Date() }).where(and(eq(playersTable.leagueId, leagueId), isNull(playersTable.leftAt)));
    await tx.delete(leaguesTable).where(eq(leaguesTable.id, leagueId));
    if (members.length) {
      const message = deletedNotice(league.name);
      await tx.insert(leagueNoticesTable).values(members.map((clerkUserId) => ({ clerkUserId, message })));
    }
  });

  // Everyone leaves its chat, so it drops out of Messages.
  leagueChat.leagueChanged(leagueId);
  res.status(204).send();
});

/** Notes for the signed-in player that they haven't cleared yet, newest first. */
router.get("/me/league-notices", requireAuth, async (req, res) => {
  const { userId } = getAuth(req);
  const rows = await db
    .select({ id: leagueNoticesTable.id, message: leagueNoticesTable.message, createdAt: leagueNoticesTable.createdAt })
    .from(leagueNoticesTable)
    .where(and(eq(leagueNoticesTable.clerkUserId, userId!), isNull(leagueNoticesTable.dismissedAt)))
    .orderBy(desc(leagueNoticesTable.createdAt));
  res.json(rows.map((r) => ({ ...r, createdAt: r.createdAt.toISOString() })));
});

router.post("/me/league-notices/:noticeId/dismiss", requireAuth, async (req, res) => {
  const { userId } = getAuth(req);
  const noticeId = parseInt(String(req.params.noticeId));
  if (isNaN(noticeId)) { res.status(400).json({ error: "Invalid notice ID" }); return; }
  await db
    .update(leagueNoticesTable)
    .set({ dismissedAt: new Date() })
    .where(and(eq(leagueNoticesTable.id, noticeId), eq(leagueNoticesTable.clerkUserId, userId!)));
  res.status(204).send();
});

export default router;
