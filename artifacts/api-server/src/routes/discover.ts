import { Router, type IRouter, type NextFunction, type Request, type Response } from "express";
import { getAuth } from "@clerk/express";
import { availabilitySummary, parseSlots } from "../lib/discoverAvailability.js";
import { ZIP_NOT_FOUND, areaForZip, distanceLabel, milesBetween, parseRadius } from "../lib/discoverArea.js";
import { formatLabel, leagueState, levelText, nearbyLeagues, outsideLevel, typeLabel } from "../lib/discoverLeagues.js";
import { shortDate } from "../lib/leagueCalendar.js";
import { isOneOf, nearbyPlayers, parseDiscoverSettings, parseFilters, PLAYS } from "../lib/discoverPlayers.js";
import { DrizzleDiscoverRepo, reliabilityOrEmpty, type DiscoverMe, type DiscoverRepo } from "../lib/discoverRepo.js";
import { logger } from "../lib/logger.js";
import { REPORT_REASONS, type ReportReason } from "@workspace/db";

// Discover, Players near you (spec: Discover; Wave 2 Session F, F1 to F14).
// - GET  /discover/me            your area, hidden profile, plays, distance and hours
// - PUT  /discover/area          change your home ZIP from Discover
// - PUT  /discover/settings      Show me in Discover, what you play, last distance
// - PUT  /discover/availability  the "When you can play" grid
// - GET  /discover/players       Players near you, with a count per distance chip
// - GET  /discover/players/:id   one player card
// Everything here is free, never Pro (spec decision 32).

/** Most players one list shows. */
export const MAX_ROWS = 100;

function requireAuth(req: Request, res: Response, next: NextFunction) {
  if (!getAuth(req).userId) {
    res.status(401).json({ error: "Unauthorized" });
    return;
  }
  next();
}

/** What the app shows about you in Discover. */
export function meView(me: DiscoverMe) {
  return {
    area: me.area ? { zip: me.area.zip, town: me.area.town, state: me.area.state } : null,
    homeZip: me.homeZip,
    hidden: me.hidden,
    plays: isOneOf(PLAYS, me.plays) ? me.plays : null,
    radius: me.radius,
    rating: me.rating,
    slots: me.slots,
    hoursFree: me.slots.length,
    freeSummary: availabilitySummary(me.slots),
    matchAlerts: me.matchAlerts ?? false,
  };
}

export function createDiscoverRouter(repo: DiscoverRepo = new DrizzleDiscoverRepo()): IRouter {
  const router: IRouter = Router();

  const fail = (res: Response, err: unknown, what: string, message: string) => {
    logger.error({ err }, what);
    res.status(500).json({ error: message });
  };

  async function loadMe(req: Request, res: Response): Promise<DiscoverMe | null> {
    const me = await repo.me(getAuth(req).userId!);
    if (!me) res.status(404).json({ error: "Finish setting up your profile first." });
    return me;
  }

  router.get("/discover/me", requireAuth, async (req, res) => {
    try {
      const me = await loadMe(req, res);
      if (me) res.json(meView(me));
    } catch (err) {
      fail(res, err, "Discover me failed", "Couldn't load Discover. Try again.");
    }
  });

  router.put("/discover/area", requireAuth, async (req, res) => {
    const area = areaForZip((req.body ?? {}).zip);
    if (!area) {
      res.status(400).json({ error: ZIP_NOT_FOUND });
      return;
    }
    try {
      const me = getAuth(req).userId!;
      await repo.setArea(me, area);
      const after = await loadMe(req, res);
      if (after) res.json(meView(after));
    } catch (err) {
      fail(res, err, "Discover area save failed", "Couldn't save your area. Try again.");
    }
  });

  router.put("/discover/settings", requireAuth, async (req, res) => {
    const input = parseDiscoverSettings(req.body);
    if ("error" in input) {
      res.status(400).json({ error: input.error });
      return;
    }
    try {
      await repo.saveSettings(getAuth(req).userId!, input);
      const after = await loadMe(req, res);
      if (after) res.json(meView(after));
    } catch (err) {
      fail(res, err, "Discover settings save failed", "Couldn't save that. Try again.");
    }
  });

  router.put("/discover/availability", requireAuth, async (req, res) => {
    const slots = parseSlots((req.body ?? {}).slots);
    if ("error" in slots) {
      res.status(400).json({ error: slots.error });
      return;
    }
    try {
      await repo.saveSlots(getAuth(req).userId!, slots);
      const after = await loadMe(req, res);
      if (after) res.json(meView(after));
    } catch (err) {
      fail(res, err, "Availability save failed", "Couldn't save your times. Try again.");
    }
  });

  router.get("/discover/players", requireAuth, async (req, res) => {
    try {
      const me = await loadMe(req, res);
      if (!me) return;
      const filters = parseFilters(req.query as Record<string, unknown>, me.radius);
      // No times set: "Free when I'm free" can't apply (F11).
      if (!me.slots.length) filters.free = false;
      if (!me.area) {
        res.json({ players: [], counts: [], radius: filters.radius, total: 0, needsArea: true });
        return;
      }
      // Fetch for the widest chip so every count is right in one read.
      const widest = Math.max(30, filters.radius);
      const candidates = await repo.near(me.clerkUserId, me.area.point, widest);
      const reliability = await repo.reliability(candidates.map((c) => c.clerkUserId));
      const result = nearbyPlayers(
        { point: me.area.point, rating: me.rating, slots: me.slots },
        candidates,
        filters,
        (id) => reliabilityOrEmpty(reliability, id),
      );
      // The nearest 100 are plenty to scroll; the count still says how many there are.
      res.json({ ...result, players: result.players.slice(0, MAX_ROWS), radius: filters.radius, total: result.players.length, needsArea: false });
    } catch (err) {
      fail(res, err, "Discover players failed", "Can't load players right now. Check your connection and try again.");
    }
  });

  router.get("/discover/players/:userId", requireAuth, async (req, res) => {
    const userId = Number(req.params.userId);
    if (!Number.isInteger(userId) || userId <= 0) {
      res.status(400).json({ error: "Invalid player" });
      return;
    }
    try {
      const me = await loadMe(req, res);
      if (!me) return;
      const p = await repo.person(me.clerkUserId, userId);
      if (!p) {
        res.status(404).json({ error: "This player isn't in Discover right now." });
        return;
      }
      const r = reliabilityOrEmpty(await repo.reliability([p.clerkUserId]), p.clerkUserId);
      const miles = me.area ? milesBetween(me.area.point, p.point) : null;
      res.json({
        userId: p.userId,
        name: p.name,
        avatarUrl: p.avatarUrl,
        rating: p.rating,
        ratingSource: p.ratingSource,
        town: p.town,
        distance: miles == null ? null : `${distanceLabel(miles)} away`,
        plays: isOneOf(PLAYS, p.plays) ? p.plays : null,
        freeSummary: availabilitySummary(p.slots),
        homeCourt: p.homeCourt ?? null,
        played: r.played,
        noShows: r.noShows,
        wins: r.wins,
        losses: r.losses,
      });
    } catch (err) {
      fail(res, err, "Discover player failed", "Can't load this player right now. Try again.");
    }
  });

  /** Open leagues near you (brief items 17 to 22), with a count per distance chip. */
  router.get("/discover/leagues", requireAuth, async (req, res) => {
    try {
      const me = await loadMe(req, res);
      if (!me) return;
      const radius = parseRadius((req.query as Record<string, unknown>).radius, me.radius);
      if (!me.area) {
        res.json({ leagues: [], counts: [], radius, total: 0, needsArea: true });
        return;
      }
      const candidates = await repo.openLeagues(me.clerkUserId, me.area.point, Math.max(30, radius));
      const { leagues, counts } = nearbyLeagues(me.area.point, me.rating, candidates, radius);
      res.json({ leagues, counts, radius, total: leagues.length, needsArea: false });
    } catch (err) {
      fail(res, err, "Discover leagues failed", "Can't load Open leagues right now. Check your connection and try again.");
    }
  });

  /** One Open league's Discover page: what it is, and where you stand with it. */
  router.get("/discover/leagues/:leagueId", requireAuth, async (req, res) => {
    const leagueId = Number(req.params.leagueId);
    if (!Number.isInteger(leagueId) || leagueId <= 0) {
      res.status(400).json({ error: "Invalid league" });
      return;
    }
    try {
      const me = await loadMe(req, res);
      if (!me) return;
      const l = await repo.openLeague(me.clerkUserId, leagueId);
      if (!l) {
        res.status(404).json({ error: "This league isn't open to new players right now." });
        return;
      }
      const { left, started, full, joining } = leagueState(l);
      res.json({
        leagueId: l.leagueId,
        name: l.name,
        organizerName: l.organizerName,
        location: l.location,
        distance: me.area ? distanceLabel(milesBetween(me.area.point, l.point)) : null,
        format: formatLabel(l.format),
        type: typeLabel(l.leagueType),
        levelText: levelText(l),
        outsideLevel: outsideLevel(l, me.rating),
        myRating: me.rating,
        startDate: l.startDate,
        startLabel: l.startDate ? shortDate(l.startDate) : null,
        seasonWeeks: l.seasonWeeks,
        started,
        full,
        rosterCap: l.rosterCap,
        spotsTaken: l.activePlayers,
        spotsLeft: left,
        joining,
        myRequest: l.myRequest,
        member: l.member,
      });
    } catch (err) {
      fail(res, err, "Discover league failed", "Can't load this league right now. Try again.");
    }
  });

  /**
   * Report from a player card (F3, F9; App Store 1.2), with "Also block" in
   * the same call. Works for players with no league player row. The account
   * reported is untouched until a moderator acts.
   */
  router.post("/discover/players/:userId/report", requireAuth, async (req, res) => {
    const me = getAuth(req).userId!;
    const userId = Number(req.params.userId);
    const b = (req.body ?? {}) as Record<string, unknown>;
    // "impersonation" is only for reports filed before Nov 7.
    if (!isOneOf(REPORT_REASONS, b.reason) || b.reason === "impersonation" || b.reason === "no_show_dispute") {
      res.status(400).json({ error: "Pick a reason for the report." });
      return;
    }
    const details = typeof b.details === "string" ? b.details.trim().slice(0, 1000) || undefined : undefined;
    if (b.reason === "other" && !details) {
      res.status(400).json({ error: "Tell us what happened." });
      return;
    }
    try {
      const subject = Number.isInteger(userId) ? await repo.accountForUser(userId) : null;
      if (!subject || subject === me) {
        res.status(404).json({ error: "This player isn't on Ball Boi anymore." });
        return;
      }
      const id = await repo.fileReport({ reporter: me, subject, userId, reason: b.reason as ReportReason, details });
      logger.warn({ reportId: id, targetType: "player", reason: b.reason }, "New content report");
      const blocked = b.block === true;
      if (blocked) await repo.block(me, subject);
      res.status(201).json({ id, status: "open", blocked });
    } catch (err) {
      fail(res, err, "Discover report failed", "We couldn't send your report. Try again.");
    }
  });

  /** Block by user id: "Also block" on a message report from a player with no league player row. */
  router.post("/discover/players/:userId/block", requireAuth, async (req, res) => {
    const me = getAuth(req).userId!;
    const userId = Number(req.params.userId);
    try {
      const target = Number.isInteger(userId) ? await repo.accountForUser(userId) : null;
      if (!target || target === me) {
        res.status(404).json({ error: "This player isn't on Ball Boi anymore." });
        return;
      }
      await repo.block(me, target);
      res.status(204).end();
    } catch (err) {
      fail(res, err, "Discover block failed", "We couldn't block this player. Try again.");
    }
  });

  /** Unblock by user id, from a blocked chat with a player who has no league player row. */
  router.delete("/discover/players/:userId/block", requireAuth, async (req, res) => {
    const me = getAuth(req).userId!;
    const userId = Number(req.params.userId);
    try {
      const target = Number.isInteger(userId) ? await repo.accountForUser(userId) : null;
      if (target) await repo.unblock(me, target);
      res.status(204).end();
    } catch (err) {
      fail(res, err, "Discover unblock failed", "We couldn't unblock this player. Try again.");
    }
  });

  return router;
}

export default createDiscoverRouter();
