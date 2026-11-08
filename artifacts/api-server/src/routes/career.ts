import { Router, type IRouter } from "express";
import { getAuth } from "@clerk/express";
import { careerStats } from "../lib/career.js";
import { DrizzleCareerRepo, type CareerRepo } from "../lib/careerRepo.js";
import { logger } from "../lib/logger.js";

// Career (spec decision 147, John, Nov 8), opened from See all on Profile's
// This season. Your own history only; free, never Pro.
// - GET /player-cards/me/career   all-time record, best win streak, sets,
//                                  games and tiebreaks, your seasons with
//                                  their results, and head-to-head

export function createCareerRouter(repo: CareerRepo = new DrizzleCareerRepo()): IRouter {
  const router = Router();

  router.get("/player-cards/me/career", async (req, res) => {
    const me = getAuth(req).userId;
    if (!me) {
      res.status(401).json({ error: "Unauthorized" });
      return;
    }
    try {
      const [data, blocked] = await Promise.all([repo.data(me), repo.blocked(me)]);
      res.json(careerStats({ ...data, account: me, blocked }));
    } catch (err) {
      logger.error({ err }, "Career failed");
      res.status(500).json({ error: "Can't load your career right now." });
    }
  });

  return router;
}

export default createCareerRouter();
