import { Router, type IRouter } from "express";
import { getAuth } from "@clerk/express";
import { logger } from "../lib/logger.js";
import { buildMatchDetail } from "../lib/matchDetail.js";
import { DrizzleMatchDetailRepo, type MatchDetailRepo } from "../lib/matchDetailRepo.js";
import { planCasualEdit } from "../lib/matchScoreEdit.js";
import { flipScore } from "../lib/quickMatch.js";

// Match detail (finding 6; decision 151, John, Nov 8): every match you
// played, league, Discover or Quick match, with one layout.
// - GET /me/matches/:matchId
// - POST /me/matches/:matchId/score/edit (Discover and Quick matches; league
//   matches use POST /leagues/:leagueId/matches/:matchId/score/edit)
//
// Who can open it:
// - Only the players in the match. A Quick match against someone you'd
//   never played (G2) is on an unlinked stand-in until they answer Yes to
//   "Was that you?", so until then it isn't theirs to open. After "Not me"
//   it never is.
// - Blocks don't open anything new: a match you both played stays yours, as
//   it already does in your results and Career, and anyone else is refused.
//   A score edit isn't pushed to someone blocked with the editor.

export interface MatchDetailDeps {
  now: () => Date;
  push: (to: string[], title: string, body: string, path: string) => Promise<unknown>;
  awardMilestones: (matchId: number) => Promise<unknown>;
}

const liveDeps: MatchDetailDeps = {
  now: () => new Date(),
  push: async (to, title, body, path) => (await import("./notifications.js")).sendPushToUsers(to, title, body, path),
  awardMilestones: async (matchId) => (await import("../lib/milestoneRepo.js")).awardMilestonesForMatch(matchId),
};

const teamOf = (m: { player1Id: number; player2Id: number; player3Id: number | null; player4Id: number | null }, side: 1 | 2) =>
  (side === 1 ? [m.player1Id, m.player3Id] : [m.player2Id, m.player4Id]).filter((id): id is number => id != null);

export function createMatchDetailRouter(repo: MatchDetailRepo = new DrizzleMatchDetailRepo(), deps: MatchDetailDeps = liveDeps): IRouter {
  const router = Router();

  router.get("/me/matches/:matchId", async (req, res) => {
    const { userId } = getAuth(req);
    if (!userId) { res.status(401).json({ error: "Unauthorized" }); return; }
    const matchId = Number(req.params.matchId);
    if (!Number.isInteger(matchId) || matchId <= 0) { res.status(400).json({ error: "Invalid id" }); return; }
    try {
      const data = await repo.load(matchId);
      if (!data) { res.status(404).json({ error: "Match not found" }); return; }
      if (!data.players.some((p) => p.clerkUserId === userId)) {
        res.status(403).json({ error: "Only the players in this match can see it." });
        return;
      }
      res.json(
        buildMatchDetail({
          match: data.match,
          league: data.league,
          plan: data.plan,
          players: data.players,
          roundNumber: data.roundNumber,
          userId,
          replay: data.replay,
          now: deps.now(),
        }),
      );
    } catch (err) {
      logger.error({ err, matchId }, "Match detail failed");
      res.status(500).json({ error: "Can't load this match right now." });
    }
  });

  /**
   * Decision 151: either player edits a Discover or Quick match's score, from
   * their own side, for 24 hours after it was entered. The latest edit stands
   * and the other player is told "Score edited by {name}". Nothing here
   * touches standings or league records: these matches have no league.
   */
  router.post("/me/matches/:matchId/score/edit", async (req, res) => {
    const { userId } = getAuth(req);
    if (!userId) { res.status(401).json({ error: "Unauthorized" }); return; }
    const matchId = Number(req.params.matchId);
    if (!Number.isInteger(matchId) || matchId <= 0) { res.status(400).json({ error: "Invalid id" }); return; }
    try {
      const data = await repo.load(matchId);
      if (!data) { res.status(404).json({ error: "Match not found" }); return; }
      const { match, players } = data;
      const accounts = players.map((p) => p.clerkUserId).filter((id): id is string => !!id);
      const mine = players.filter((p) => p.clerkUserId === userId);
      const plan = planCasualEdit({ match, userId, accounts, myPlayerIds: mine.map((p) => p.id), raw: req.body?.score, now: deps.now() });
      if (!plan.ok) { res.status(plan.status).json({ error: plan.error }); return; }

      const caller = mine[0]!;
      const at = deps.now();
      const saved = await repo.saveEdit(matchId, match.score!, { score: plan.score, winnerId: plan.winnerId, byClerkUserId: userId, byName: caller.name, at });
      if (!saved) { res.status(409).json({ error: "This score changed. Pull down to see the latest." }); return; }

      // Tell everyone else in the match, each from their own side, except anyone blocked with the editor.
      const blocked = await repo.blocked(userId);
      const team1 = teamOf(match, 1);
      const others = players.filter((p) => p.clerkUserId && p.clerkUserId !== userId && !blocked.has(p.clerkUserId));
      Promise.all(
        others.map((p) => {
          const theirs = team1.includes(p.id) ? plan.score : flipScore(plan.score);
          return deps.push([p.clerkUserId!], "Score edited", `Score edited by ${caller.name}: ${theirs}.`, `/match/${matchId}`).catch(() => {});
        }),
      ).catch((err) => logger.error({ err, matchId }, "Couldn't send score edit notifications"));

      await deps.awardMilestones(matchId);
      res.json({
        matchId: saved.id,
        score: saved.score!,
        winnerId: saved.winnerId,
        editedAt: (saved.scoreEditedAt ?? at).toISOString(),
        editedBy: caller.name,
      });
    } catch (err) {
      logger.error({ err, matchId }, "Score edit failed");
      res.status(500).json({ error: "Couldn't save the score. Try again." });
    }
  });

  return router;
}

export default createMatchDetailRouter();
