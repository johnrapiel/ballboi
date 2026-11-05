import { Router, type IRouter, type NextFunction, type Request, type Response } from "express";
import { getAuth } from "@clerk/express";
import { MAX_RADIUS, distanceLabel, milesBetween, parseRadius } from "../lib/discoverArea.js";
import { nearbyLeagues, openLeagueCard } from "../lib/discoverLeagues.js";
import { PLAYS, nearbyPlayers, parseDiscoverSettings, parseFilters, type Plays } from "../lib/discoverPlayers.js";
import { DrizzleDiscoverRepo, type DiscoverMe, type DiscoverRepo } from "../lib/discoverRepo.js";
import { logger } from "../lib/logger.js";

// Discover (spec: Discover): Players near you, Open leagues near you, the
// player's Discover settings (hidden profile, what they play, when they're
// free), and block. Asking to join an Open league goes through
// POST /leagues/:leagueId/join-requests.
// Messaging a Discover player goes through POST /messages with their userId,
// so a first message lands in their Message Requests.

function requireAuth(req: Request, res: Response, next: NextFunction) {
  if (!getAuth(req).userId) {
    res.status(401).json({ error: "Unauthorized" });
    return;
  }
  next();
}

/** Why Discover can't show players yet, in the player's words, or null. */
export function homeAreaProblem(me: DiscoverMe): string | null {
  if (me.point) return null;
  if (me.homeZip) return `We couldn't place zip code ${me.homeZip}. Try a nearby zip code in Edit profile.`;
  return "Add your home area so Discover can show players near you.";
}

function settingsBody(me: DiscoverMe) {
  return {
    hidden: me.hidden,
    plays: (PLAYS as readonly string[]).includes(me.plays ?? "") ? (me.plays as Plays) : null,
    freeTimes: me.freeTimes ?? [],
    homeCourt: me.homeCourt,
  };
}

export function createDiscoverRouter(getRepo: () => DiscoverRepo = () => new DrizzleDiscoverRepo()): IRouter {
  const router: IRouter = Router();

  const wrap =
    (fn: (repo: DiscoverRepo, me: string, req: Request, res: Response) => Promise<void>) =>
    async (req: Request, res: Response) => {
      try {
        await fn(getRepo(), getAuth(req).userId!, req, res);
      } catch (err) {
        logger.error({ err }, "Discover request failed");
        res.status(500).json({ error: "Something went wrong. Try again." });
      }
    };

  /**
   * GET /discover/players?radius=10&level=near&plays=any&free=any
   * Players near you, nearest first, with how many each radius step would show.
   */
  router.get(
    "/discover/players",
    requireAuth,
    wrap(async (repo, viewer, req, res) => {
      const me = await repo.me(viewer);
      if (!me) {
        res.status(404).json({ error: "User profile not found" });
        return;
      }
      const filters = parseFilters(req.query as Record<string, unknown>, parseRadius);
      const problem = homeAreaProblem(me);
      if (!me.point || problem) {
        res.json({ filters, hidden: me.hidden, homeAreaProblem: problem, myRating: me.rating, counts: [], players: [] });
        return;
      }
      const candidates = await repo.near(viewer, me.point, MAX_RADIUS);
      const { players, counts } = nearbyPlayers({ point: me.point, rating: me.rating }, candidates, filters);
      res.json({ filters, hidden: me.hidden, homeAreaProblem: null, myRating: me.rating, counts, players });
    }),
  );

  /** GET /discover/players/:userId: one Discover player, only while they're in your Discover. */
  router.get(
    "/discover/players/:userId",
    requireAuth,
    wrap(async (repo, viewer, req, res) => {
      const id = Number(req.params.userId);
      const [me, them] = await Promise.all([repo.me(viewer), Number.isInteger(id) ? repo.person(viewer, id) : null]);
      const miles = me?.point && them ? milesBetween(me.point, them.point) : null;
      if (!me || !them || miles == null || miles > MAX_RADIUS) {
        res.status(404).json({ error: "This player isn't in Discover right now." });
        return;
      }
      res.json({
        userId: them.userId,
        name: them.name,
        avatarUrl: them.avatarUrl,
        rating: them.rating,
        ratingSource: them.ratingSource,
        distanceLabel: distanceLabel(miles),
        plays: (PLAYS as readonly string[]).includes(them.plays ?? "") ? them.plays : null,
        freeTimes: them.freeTimes ?? [],
        played: them.played,
        noShows: them.noShows ?? 0,
        homeCourt: them.homeCourt ?? null,
      });
    }),
  );

  router.post(
    "/discover/players/:userId/block",
    requireAuth,
    wrap(async (repo, viewer, req, res) => {
      const id = Number(req.params.userId);
      if (!Number.isInteger(id) || !(await repo.block(viewer, id))) {
        res.status(404).json({ error: "We couldn't find this player to block." });
        return;
      }
      res.status(201).json({ blocked: true });
    }),
  );

  router.delete(
    "/discover/players/:userId/block",
    requireAuth,
    wrap(async (repo, viewer, req, res) => {
      const id = Number(req.params.userId);
      if (Number.isInteger(id)) await repo.unblock(viewer, id);
      res.status(204).end();
    }),
  );

  /** GET /discover/leagues?radius=10: Open leagues near your home area, ones taking requests first. */
  router.get(
    "/discover/leagues",
    requireAuth,
    wrap(async (repo, viewer, req, res) => {
      const me = await repo.me(viewer);
      if (!me) {
        res.status(404).json({ error: "User profile not found" });
        return;
      }
      const radius = parseRadius((req.query as Record<string, unknown>).radius);
      if (!me.point) {
        res.json({ radius, homeAreaProblem: homeAreaProblem(me), leagues: [] });
        return;
      }
      const candidates = await repo.openLeagues(viewer, me.point, radius);
      res.json({ radius, homeAreaProblem: null, leagues: nearbyLeagues(me.point, candidates, radius) });
    }),
  );

  /** GET /discover/leagues/:leagueId: an Open league's preview, only while it's in your Discover. */
  router.get(
    "/discover/leagues/:leagueId",
    requireAuth,
    wrap(async (repo, viewer, req, res) => {
      const id = Number(req.params.leagueId);
      const [me, league] = await Promise.all([repo.me(viewer), Number.isInteger(id) ? repo.openLeague(viewer, id) : null]);
      const card = me?.point && league ? openLeagueCard(me.point, league) : null;
      if (!league || !card || card.miles > MAX_RADIUS) {
        res.status(404).json({ error: "This league isn't in Discover right now." });
        return;
      }
      const { miles: _miles, ...rest } = card;
      res.json({
        ...rest,
        description: league.description,
        seasonWeeks: league.seasonWeeks,
        endDate: league.endDate,
        playoffSize: league.playoffSize,
        matchDay: league.matchDay,
        matchTime: league.matchTime,
        timeZone: league.timeZone,
        players: league.activePlayers,
        rosterCap: league.rosterCap,
        adminName: league.adminName,
      });
    }),
  );

  /** GET /users/me/discover: hidden profile, what you play, when you're usually free. */
  router.get(
    "/users/me/discover",
    requireAuth,
    wrap(async (repo, viewer, _req, res) => {
      const me = await repo.me(viewer);
      if (!me) {
        res.status(404).json({ error: "User profile not found" });
        return;
      }
      res.json(settingsBody(me));
    }),
  );

  /** PUT /users/me/discover { hidden?, plays?, freeTimes? }: saves whichever are sent. */
  router.put(
    "/users/me/discover",
    requireAuth,
    wrap(async (repo, viewer, req, res) => {
      const input = parseDiscoverSettings(req.body);
      if ("error" in input) {
        res.status(400).json({ error: input.error });
        return;
      }
      await repo.saveSettings(viewer, input);
      const me = await repo.me(viewer);
      if (!me) {
        res.status(404).json({ error: "User profile not found" });
        return;
      }
      res.json(settingsBody(me));
    }),
  );

  return router;
}

export default createDiscoverRouter();
