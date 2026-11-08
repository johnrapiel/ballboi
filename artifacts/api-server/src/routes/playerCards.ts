import { Router, type IRouter, type NextFunction, type Request, type Response } from "express";
import { getAuth } from "@clerk/express";
import { logger } from "../lib/logger.js";
import { cardView, seasonStats, seasonWindow } from "../lib/playerCard.js";
import { playerMatches } from "../lib/playerMatches.js";
import { DrizzlePlayerCardRepo, type PlayerCardRepo } from "../lib/playerCardRepo.js";

// The player card (spec decisions 138 to 140, John, Nov 8): the same card
// everywhere. Free, never Pro.
// - GET /player-cards/me                your own card and This season, for Profile
// - GET /player-cards/:userId           another player's card, from Discover (decision 139)
// - GET /player-cards/:userId/matches   their Upcoming matches, Results and your
//                                       head-to-head (decision 143)
// A player who blocked you or whom you blocked, and a hidden profile, are
// "not in Discover": the same 404 either way, so neither can be told apart.

const NOT_IN_DISCOVER = "This player isn't in Discover right now.";

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

  /** The other player, or null after sending the 404. */
  async function visible(req: Request, res: Response) {
    const viewer = getAuth(req).userId!;
    const userId = Number(req.params.userId);
    if (!Number.isInteger(userId) || userId <= 0) {
      res.status(400).json({ error: "Invalid player" });
      return null;
    }
    const [found, blocked] = await Promise.all([repo.other(viewer, userId), repo.blocked(viewer)]);
    if (!found || found.hidden || found.person.clerkUserId === viewer || blocked.has(found.person.clerkUserId)) {
      res.status(404).json({ error: NOT_IN_DISCOVER });
      return null;
    }
    return { viewer, blocked, ...found };
  }

  router.get("/player-cards/:userId", requireAuth, async (req, res) => {
    try {
      const v = await visible(req, res);
      if (!v) return;
      res.json(cardView(v.person, { distance: v.distance, season: await season(v.person.clerkUserId, clock()), you: false }));
    } catch (err) {
      logger.error({ err }, "Player card failed");
      res.status(500).json({ error: "Can't load this player right now." });
    }
  });

  router.get("/player-cards/:userId/matches", requireAuth, async (req, res) => {
    try {
      const v = await visible(req, res);
      if (!v) return;
      const now = clock();
      const data = await repo.matchData(v.person.clerkUserId, v.viewer, now);
      res.json(playerMatches({ ...data, target: v.person.clerkUserId, viewer: v.viewer, now, blocked: v.blocked }));
    } catch (err) {
      logger.error({ err }, "Player matches failed");
      res.status(500).json({ error: "Can't load this player's matches right now." });
    }
  });

  return router;
}

export default createPlayerCardsRouter();
