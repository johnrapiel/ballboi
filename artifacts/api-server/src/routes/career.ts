import { Router, type IRouter } from "express";
import { getAuth } from "@clerk/express";
import { careerStats } from "../lib/career.js";
import { DrizzleCareerRepo, type CareerRepo } from "../lib/careerRepo.js";
import { logger } from "../lib/logger.js";
import { DrizzleMilestoneRepo, type MilestoneRepo } from "../lib/milestoneRepo.js";
import { isMilestoneKind, MILESTONE_KINDS } from "../lib/milestones.js";

// Career (spec decision 147, John, Nov 8), opened from See all on Profile's
// This season, and your milestones (decisions 149 and 150). Your own history
// only; free, never Pro.
// - GET  /player-cards/me/career           all-time record, best win streak,
//                                           sets, games and tiebreaks, your
//                                           seasons with their results,
//                                           head-to-head and milestones
// - GET  /player-cards/me/milestones/new   milestones whose moment hasn't
//                                           played yet, oldest first
// - POST /player-cards/me/milestones/seen  { kinds } the moment played

export function createCareerRouter(repo: CareerRepo = new DrizzleCareerRepo(), milestones: MilestoneRepo = new DrizzleMilestoneRepo(), clock: () => Date = () => new Date()): IRouter {
  const router = Router();

  router.get("/player-cards/me/career", async (req, res) => {
    const me = getAuth(req).userId;
    if (!me) {
      res.status(401).json({ error: "Unauthorized" });
      return;
    }
    try {
      const [data, blocked, earned] = await Promise.all([repo.data(me), repo.blocked(me), milestones.stored(me)]);
      res.json({
        ...careerStats({ ...data, account: me, blocked }),
        milestones: earned
          .sort((a, b) => a.earnedAt.getTime() - b.earnedAt.getTime() || MILESTONE_KINDS.indexOf(a.kind) - MILESTONE_KINDS.indexOf(b.kind))
          .map((m) => ({ kind: m.kind, earnedAt: m.earnedAt.toISOString() })),
      });
    } catch (err) {
      logger.error({ err }, "Career failed");
      res.status(500).json({ error: "Can't load your career right now." });
    }
  });

  router.get("/player-cards/me/milestones/new", async (req, res) => {
    const me = getAuth(req).userId;
    if (!me) {
      res.status(401).json({ error: "Unauthorized" });
      return;
    }
    try {
      const fresh = (await milestones.stored(me))
        .filter((m) => !m.seenAt)
        .sort((a, b) => a.earnedAt.getTime() - b.earnedAt.getTime() || MILESTONE_KINDS.indexOf(a.kind) - MILESTONE_KINDS.indexOf(b.kind));
      res.json({ milestones: fresh.map((m) => ({ kind: m.kind, earnedAt: m.earnedAt.toISOString() })) });
    } catch (err) {
      logger.error({ err }, "New milestones failed");
      res.status(500).json({ error: "Can't load your milestones right now." });
    }
  });

  router.post("/player-cards/me/milestones/seen", async (req, res) => {
    const me = getAuth(req).userId;
    if (!me) {
      res.status(401).json({ error: "Unauthorized" });
      return;
    }
    const kinds = req.body?.kinds;
    if (!Array.isArray(kinds) || !kinds.every((k): k is string => typeof k === "string")) {
      res.status(400).json({ error: "kinds must be a list of milestones" });
      return;
    }
    try {
      await milestones.markSeen(me, kinds.filter(isMilestoneKind), clock());
      res.json({ ok: true });
    } catch (err) {
      logger.error({ err }, "Marking milestones seen failed");
      res.status(500).json({ error: "Couldn't save that. Try again." });
    }
  });

  return router;
}

export default createCareerRouter();
