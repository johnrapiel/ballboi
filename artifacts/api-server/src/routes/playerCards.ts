import { Router, type IRouter, type NextFunction, type Request, type Response } from "express";
import { getAuth } from "@clerk/express";
import { logger } from "../lib/logger.js";
import { cardView, seasonStats, seasonWindow } from "../lib/playerCard.js";
import { DrizzlePlayerCardRepo, type PlayerCardRepo } from "../lib/playerCardRepo.js";

// The player card (spec decisions 138 to 140, John, Nov 8): the same card
// everywhere. Free, never Pro.
// - GET /player-cards/me   your own card and This season, for Profile

function requireAuth(req: Request, res: Response, next: NextFunction) {
  if (!getAuth(req).userId) {
    res.status(401).json({ error: "Unauthorized" });
    return;
  }
  next();
}

export function createPlayerCardsRouter(repo: PlayerCardRepo = new DrizzlePlayerCardRepo(), clock: () => Date = () => new Date()): IRouter {
  const router = Router();

  /** This season for one account, by F13's rules (decision 121). */
  async function season(clerkUserId: string, now: Date) {
    const window = seasonWindow(await repo.seasons(), now.toISOString().slice(0, 10));
    const [{ matches, owner }, noShows] = await Promise.all([repo.scored(clerkUserId), repo.noShows(clerkUserId, window, now)]);
    return { ...window, ...seasonStats(clerkUserId, matches, (id) => owner.get(id) ?? null, window, noShows) };
  }

  router.get("/player-cards/me", requireAuth, async (req, res) => {
    const me = getAuth(req).userId!;
    try {
      const person = await repo.me(me);
      if (!person) {
        res.status(404).json({ error: "Finish setting up your profile first." });
        return;
      }
      res.json(cardView(person, { distance: null, season: await season(me, clock()), you: true }));
    } catch (err) {
      logger.error({ err }, "Player card failed");
      res.status(500).json({ error: "Can't load your player card right now." });
    }
  });

  return router;
}

export default createPlayerCardsRouter();
