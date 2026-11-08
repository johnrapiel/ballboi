import { Router, type IRouter, type NextFunction, type Request, type Response } from "express";
import { getAuth } from "@clerk/express";
import { logger } from "../lib/logger";
import { buildSearchResults, cleanQuery, STRANGER_LIMIT } from "../lib/playerSearch";
import { DrizzlePlayerSearchRepo, type PlayerSearchRepo } from "../lib/playerSearchRepo";

// GET /players/search?q=: the one player search behind Quick match's
// opponent step and New message (findings #15 and #18). Mounted before the
// players router so "search" isn't read as a player id.

function requireAuth(req: Request, res: Response, next: NextFunction) {
  if (!getAuth(req).userId) {
    res.status(401).json({ error: "Unauthorized" });
    return;
  }
  next();
}

export function createPlayerSearchRouter(repo: PlayerSearchRepo = new DrizzlePlayerSearchRepo()): IRouter {
  const router: IRouter = Router();

  router.get("/players/search", requireAuth, async (req: Request, res: Response) => {
    const me = getAuth(req).userId!;
    const query = cleanQuery(req.query.q);
    try {
      const [connected, blocked] = await Promise.all([repo.connected(me), repo.blocked(me)]);
      // Ask for enough extra rows that removing people you already know still
      // leaves a full page, plus one to tell whether there are more.
      const strangers = await repo.findable(me, query, STRANGER_LIMIT + connected.length + 1);
      res.json(buildSearchResults({ me, query, blocked, connected, strangers }));
    } catch (err) {
      logger.error({ err }, "Player search failed");
      res.status(500).json({ error: "Couldn't search players. Try again." });
    }
  });

  return router;
}

export default createPlayerSearchRouter();
