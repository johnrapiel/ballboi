import { Router, type IRouter } from "express";
import { getAuth } from "@clerk/express";
import { logger } from "../lib/logger.js";
import { buildRecap } from "../lib/recap.js";
import { DrizzleRecapRepo, type RecapRepo } from "../lib/recapRepo.js";

// The match recap (spec decision 148, John, Nov 8): what the shareable image
// shows. Only the players in the match can get it, and only once it has a
// score. League, Discover and Quick matches alike.
// - GET /me/matches/:matchId/recap

export function createRecapRouter(repo: RecapRepo = new DrizzleRecapRepo(), clock: () => Date = () => new Date()): IRouter {
  const router = Router();

  router.get("/me/matches/:matchId/recap", async (req, res) => {
    const me = getAuth(req).userId;
    if (!me) {
      res.status(401).json({ error: "Unauthorized" });
      return;
    }
    const matchId = Number(req.params.matchId);
    if (!Number.isInteger(matchId) || matchId <= 0) {
      res.status(400).json({ error: "Invalid id" });
      return;
    }
    try {
      const loaded = await repo.load(matchId);
      if (!loaded) {
        res.status(404).json({ error: "Match not found" });
        return;
      }
      const first = buildRecap({ ...loaded, viewer: me, season: null });
      if (!first.ok) {
        res.status(first.status).json({ error: first.error });
        return;
      }
      const at = loaded.match.completedAt;
      const day = (at ?? clock().toISOString()).slice(0, 10);
      const season = await repo.season(me, day, at);
      res.json({ ...first.recap, season });
    } catch (err) {
      logger.error({ err, matchId }, "Recap failed");
      res.status(500).json({ error: "Can't make this recap right now." });
    }
  });

  return router;
}

export default createRecapRouter();
