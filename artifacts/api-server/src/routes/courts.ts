import { Router, type IRouter, type NextFunction, type Request, type Response } from "express";
import { getAuth } from "@clerk/express";

import { DAILY_COURT_LIMIT, courtCard, findSameCourt, nearbyCourts, parseNewCourt } from "../lib/courtDirectory.js";
import { DrizzleCourtRepo, type CourtRepo } from "../lib/courtRepo.js";
import { parseRadius } from "../lib/discoverArea.js";
import { DrizzleDiscoverRepo, type DiscoverRepo } from "../lib/discoverRepo.js";
import { logger } from "../lib/logger.js";
import { FirstMessageFilter } from "../messaging/filter.js";
import { requireAdmin } from "../middlewares/requireAdmin.js";
import { homeAreaProblem } from "./discover.js";

// The court directory (spec: Discover > Court directory: "public and club
// courts with surface, lights, and court count; players can add missing
// courts. Feeds home court, match requests, and open matches"), and the
// player's optional home court. Courts can be reported (POST /reports with
// targetType "court"); a moderator can hide one.

function requireAuth(req: Request, res: Response, next: NextFunction) {
  if (!getAuth(req).userId) {
    res.status(401).json({ error: "Unauthorized" });
    return;
  }
  next();
}

export function createCourtsRouter(
  getCourts: () => CourtRepo = () => new DrizzleCourtRepo(),
  getDiscover: () => DiscoverRepo = () => new DrizzleDiscoverRepo(),
  filter: FirstMessageFilter = FirstMessageFilter.fromEnv(),
): IRouter {
  const router: IRouter = Router();
  const wrap =
    (fn: (req: Request, res: Response) => Promise<void>) =>
    async (req: Request, res: Response) => {
      try {
        await fn(req, res);
      } catch (err) {
        logger.error({ err }, "Courts request failed");
        res.status(500).json({ error: "Something went wrong. Try again." });
      }
    };

  /** GET /courts?radius=10: courts near your home area, nearest first. */
  router.get(
    "/courts",
    requireAuth,
    wrap(async (req, res) => {
      const viewer = getAuth(req).userId!;
      const me = await getDiscover().me(viewer);
      if (!me) {
        res.status(404).json({ error: "User profile not found" });
        return;
      }
      const radius = parseRadius((req.query as Record<string, unknown>).radius);
      if (!me.point) {
        res.json({ radius, homeAreaProblem: homeAreaProblem(me), homeCourtId: me.homeCourt?.courtId ?? null, courts: [] });
        return;
      }
      const rows = await getCourts().near(me.point, radius);
      res.json({ radius, homeAreaProblem: null, homeCourtId: me.homeCourt?.courtId ?? null, courts: nearbyCourts(me.point, rows, radius) });
    }),
  );

  /** POST /courts: add a missing court. An existing court with the same name nearby comes back instead. */
  router.post(
    "/courts",
    requireAuth,
    wrap(async (req, res) => {
      const viewer = getAuth(req).userId!;
      const input = parseNewCourt(req.body, (t) => filter.check(t).ok);
      if ("error" in input) {
        res.status(400).json({ error: input.error });
        return;
      }
      const repo = getCourts();
      const [me, nearby] = await Promise.all([getDiscover().me(viewer), repo.near(input.point, 1)]);
      const same = findSameCourt(nearby, input);
      if (same) {
        const { miles: _m, ...card } = courtCard(me?.point ?? null, same);
        res.status(200).json({ ...card, existing: true });
        return;
      }
      const dayAgo = new Date(Date.now() - 24 * 60 * 60 * 1000);
      if ((await repo.addedSince(viewer, dayAgo)) >= DAILY_COURT_LIMIT) {
        res.status(429).json({ error: `You can add ${DAILY_COURT_LIMIT} courts a day. Try again tomorrow.` });
        return;
      }
      const created = await repo.create(viewer, input);
      const { miles: _m, ...card } = courtCard(me?.point ?? null, created);
      res.status(201).json({ ...card, existing: false });
    }),
  );

  /** PUT /users/me/home-court { courtId | null }: your optional home court. */
  router.put(
    "/users/me/home-court",
    requireAuth,
    wrap(async (req, res) => {
      const raw = (req.body ?? {}).courtId;
      if (raw !== null && !Number.isInteger(raw)) {
        res.status(400).json({ error: "Pick a court from the list." });
        return;
      }
      if (!(await getCourts().setHomeCourt(getAuth(req).userId!, raw))) {
        res.status(404).json({ error: "We couldn't find that court." });
        return;
      }
      res.json({ homeCourtId: raw });
    }),
  );

  /** Moderators: hide a reported court, or show it again. */
  for (const [method, hidden] of [["post", true], ["delete", false]] as const) {
    router[method](
      "/admin/courts/:courtId/hide",
      requireAdmin,
      wrap(async (req, res) => {
        const id = Number(req.params.courtId);
        if (!Number.isInteger(id) || !(await getCourts().setHidden(id, hidden))) {
          res.status(404).json({ error: "Court not found" });
          return;
        }
        res.json({ courtId: id, hidden });
      }),
    );
  }

  return router;
}

export default createCourtsRouter();
