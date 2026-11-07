import { Router, type IRouter, type NextFunction, type Request, type Response } from "express";
import { getAuth } from "@clerk/express";
import { COURT_RADIUS, DAILY_COURT_LIMIT, MAX_COURTS, courtCard, findSameCourt, listCourts, parseNewCourt } from "../lib/courtDirectory.js";
import { DrizzleCourtRepo, type CourtRepo } from "../lib/courtRepo.js";
import { DrizzleDiscoverRepo, type DiscoverRepo } from "../lib/discoverRepo.js";
import { logger } from "../lib/logger.js";

// The court directory (spec: Discover > Court directory; F4):
// - GET  /courts?q=           nearest first, searchable; anywhere when your area has none
// - POST /courts              add a missing court (name and address)
// - GET  /courts/home         your home court
// - PUT  /courts/home         set or clear it ({ courtId: number | null })
// Feeds home court (player card) and the court of an open match.

function requireAuth(req: Request, res: Response, next: NextFunction) {
  if (!getAuth(req).userId) {
    res.status(401).json({ error: "Unauthorized" });
    return;
  }
  next();
}

export function createCourtsRouter(courts: CourtRepo = new DrizzleCourtRepo(), discover: DiscoverRepo = new DrizzleDiscoverRepo()): IRouter {
  const router: IRouter = Router();

  const fail = (res: Response, err: unknown, what: string, message: string) => {
    logger.error({ err }, what);
    res.status(500).json({ error: message });
  };

  router.get("/courts", requireAuth, async (req, res) => {
    const me = getAuth(req).userId!;
    const q = typeof req.query.q === "string" ? req.query.q.trim().slice(0, 60) : "";
    try {
      const mine = await discover.me(me);
      const point = mine?.area?.point ?? null;
      let rows = point ? await courts.near(point, COURT_RADIUS) : [];
      // Searching for a court farther away (or with no area yet): look everywhere.
      if (q && !rows.some((r) => `${r.name} ${r.address}`.toLowerCase().includes(q.toLowerCase().split(/\s+/)[0]))) {
        const far = await courts.search(q, MAX_COURTS);
        const seen = new Set(rows.map((r) => r.id));
        rows = [...rows, ...far.filter((r) => !seen.has(r.id))];
      }
      const home = await courts.homeCourt(me);
      res.json({ courts: listCourts(point, rows, q), homeCourtId: home?.id ?? null });
    } catch (err) {
      fail(res, err, "Court list failed", "Can't load courts right now. Check your connection and try again.");
    }
  });

  router.post("/courts", requireAuth, async (req, res) => {
    const me = getAuth(req).userId!;
    const parsed = parseNewCourt(req.body);
    if ("error" in parsed) {
      res.status(400).json({ error: parsed.error });
      return;
    }
    try {
      const same = findSameCourt(await courts.inZip(parsed.zip), parsed);
      const mine = await discover.me(me);
      const point = mine?.area?.point ?? null;
      if (same) {
        res.status(200).json({ ...strip(courtCard(point, same)), existing: true });
        return;
      }
      if ((await courts.addedToday(me)) >= DAILY_COURT_LIMIT) {
        res.status(429).json({ error: "You've added a lot of courts today. Try again tomorrow." });
        return;
      }
      const row = await courts.add(me, parsed);
      res.status(201).json({ ...strip(courtCard(point, row)), existing: false });
    } catch (err) {
      fail(res, err, "Court add failed", "Couldn't add the court. Try again.");
    }
  });

  router.get("/courts/home", requireAuth, async (req, res) => {
    try {
      const me = getAuth(req).userId!;
      const home = await courts.homeCourt(me);
      const mine = await discover.me(me);
      res.json({ court: home ? strip(courtCard(mine?.area?.point ?? null, home)) : null });
    } catch (err) {
      fail(res, err, "Home court failed", "Can't load your home court. Try again.");
    }
  });

  router.put("/courts/home", requireAuth, async (req, res) => {
    const me = getAuth(req).userId!;
    const raw = (req.body ?? {}).courtId;
    if (raw !== null && !(typeof raw === "number" && Number.isInteger(raw) && raw > 0)) {
      res.status(400).json({ error: "Pick a court from the list." });
      return;
    }
    try {
      if (raw !== null && !(await courts.one(raw))) {
        res.status(404).json({ error: "That court isn't in the directory any more." });
        return;
      }
      await courts.setHomeCourt(me, raw);
      const home = raw === null ? null : await courts.one(raw);
      const mine = await discover.me(me);
      res.json({ court: home ? strip(courtCard(mine?.area?.point ?? null, home)) : null });
    } catch (err) {
      fail(res, err, "Home court save failed", "Couldn't save your home court. Try again.");
    }
  });

  return router;
}

const strip = <T extends { miles: number | null }>({ miles: _m, ...rest }: T) => rest;

export default createCourtsRouter();
