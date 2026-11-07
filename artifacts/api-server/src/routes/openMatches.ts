import { Router, type IRouter, type NextFunction, type Request, type Response } from "express";
import { getAuth } from "@clerk/express";
import { DrizzleDiscoverRepo, type DiscoverRepo } from "../lib/discoverRepo.js";
import { distanceLabel, milesBetween, parseRadius } from "../lib/discoverArea.js";
import { logger } from "../lib/logger.js";
import {
  alertRecipients,
  chatTitle,
  levelText,
  nearbyOpenMatches,
  parseNewOpenMatch,
  spotsLeft,
  windowLabel,
  type OpenMatchRow,
} from "../lib/openMatch.js";
import { DrizzleOpenMatchRepo, type OpenMatchRepo } from "../lib/openMatchRepo.js";
import { sendPushToUsers } from "./notifications.js";

// Open matches (spec: Discover > Open matches; F6; brief items 38 to 46).
// - GET  /open-matches?radius=          open posts near you, soonest first, with counts
// - POST /open-matches                  post one
// - GET  /open-matches/mine             yours and ones you're in, for Home
// - GET  /open-matches/:id              one post, who's in, and what you can do
// - POST /open-matches/:id/join|drop|cancel, /remove { userId }
// - GET  /open-matches/:id/messages?after=, POST /open-matches/:id/messages { text }
// Free, never Pro.

export type Push = (userIds: string[], title: string, body: string, link?: string) => Promise<void>;

function requireAuth(req: Request, res: Response, next: NextFunction) {
  if (!getAuth(req).userId) {
    res.status(401).json({ error: "Unauthorized" });
    return;
  }
  next();
}

export const SPOT_FILLED = "This spot just filled";
/** A join refused because of a block, worded so it never says who or why. */
export const NOT_AVAILABLE = "This match isn't available.";

export function createOpenMatchesRouter(
  repo: OpenMatchRepo = new DrizzleOpenMatchRepo(),
  discover: DiscoverRepo = new DrizzleDiscoverRepo(),
  push: Push = sendPushToUsers,
  clock: () => Date = () => new Date(),
): IRouter {
  const router: IRouter = Router();
  const fail = (res: Response, err: unknown, what: string, message: string) => {
    logger.error({ err }, what);
    res.status(500).json({ error: message });
  };
  const notify = (to: string[], title: string, body: string) => {
    if (to.length) push(to, title, body, "/discover").catch((err) => logger.warn({ err }, "Open match push failed"));
  };

  async function detail(m: OpenMatchRow & { matchId: number | null }, me: string) {
    const mine = await discover.me(me);
    const people = await repo.people([m.posterClerkUserId, ...m.joined]);
    // A block made after both joined: they still hold their spots, but each is left out of the other's Players.
    const hidden = await repo.blockedAmong(me, [m.posterClerkUserId, ...m.joined]);
    const person = (id: string, poster: boolean) => ({
      userId: people.get(id)?.userId ?? 0,
      name: id === me ? "You" : (people.get(id)?.name ?? "Player"),
      rating: people.get(id)?.rating ?? null,
      poster,
      me: id === me,
    });
    const role = m.posterClerkUserId === me ? "poster" : m.joined.includes(me) ? "in" : "none";
    const now = clock();
    return {
      id: m.id,
      when: windowLabel(m.startsAt, m.endsAt, m.timeZone),
      startsAt: m.startsAt.toISOString(),
      endsAt: m.endsAt.toISOString(),
      format: m.format === "doubles" ? "doubles" : "singles",
      levelText: levelText(m.minRating, m.maxRating),
      courtName: m.courtName,
      distance: mine?.area ? distanceLabel(milesBetween(mine.area.point, m.point)) : null,
      note: m.note,
      status: m.status,
      spots: m.spots,
      spotsLeft: spotsLeft(m),
      total: m.spots + 1,
      players: [
        ...(hidden.has(m.posterClerkUserId) ? [] : [person(m.posterClerkUserId, true)]),
        ...m.joined.filter((id) => !hidden.has(id)).map((id) => person(id, false)),
      ],
      role,
      started: now >= m.startsAt,
      chatTitle: chatTitle(m),
      matchId: m.matchId,
    };
  }

  router.get("/open-matches", requireAuth, async (req, res) => {
    const me = getAuth(req).userId!;
    try {
      const mine = await discover.me(me);
      const radius = parseRadius((req.query as Record<string, unknown>).radius, mine?.radius ?? 10);
      const notices = (await repo.takeNotices(me)).map((m) => ({ id: m.id, when: windowLabel(m.startsAt, m.endsAt, m.timeZone), courtName: m.courtName, format: m.format }));
      if (!mine?.area) {
        res.json({ matches: [], counts: [], radius, total: 0, needsArea: true, matchAlerts: mine?.matchAlerts ?? false, notices });
        return;
      }
      const rows = await repo.near(me, mine.area.point, Math.max(30, radius), clock());
      const { matches, counts } = nearbyOpenMatches(me, mine.area.point, rows, radius);
      res.json({ matches, counts, radius, total: matches.length, needsArea: false, matchAlerts: mine.matchAlerts ?? false, notices });
    } catch (err) {
      fail(res, err, "Open matches failed", "Can't load open matches right now. Check your connection and try again.");
    }
  });

  router.get("/open-matches/mine", requireAuth, async (req, res) => {
    const me = getAuth(req).userId!;
    try {
      const rows = (await repo.mine(me, clock())).sort((a, b) => a.startsAt.getTime() - b.startsAt.getTime());
      res.json({
        matches: rows.map((m) => ({
          id: m.id,
          when: windowLabel(m.startsAt, m.endsAt, m.timeZone),
          format: m.format === "doubles" ? "doubles" : "singles",
          courtName: m.courtName,
          status: m.status,
          spotsLeft: spotsLeft(m),
          total: m.spots + 1,
          chatTitle: chatTitle(m),
        })),
      });
    } catch (err) {
      fail(res, err, "My open matches failed", "Can't load your matches right now.");
    }
  });

  router.post("/open-matches", requireAuth, async (req, res) => {
    const me = getAuth(req).userId!;
    const now = clock();
    try {
      const mine = await discover.me(me);
      if (!mine?.area) {
        res.status(400).json({ error: "Add your ZIP in Discover first, so players near you can find your post." });
        return;
      }
      const parsed = parseNewOpenMatch(req.body, now, mine.rating);
      if ("error" in parsed) {
        res.status(400).json({ error: parsed.error });
        return;
      }
      const courtName = parsed.courtId ? await repo.courtName(parsed.courtId) : null;
      if (parsed.courtId && !courtName) {
        res.status(400).json({ error: "That court isn't in the directory any more. Pick another." });
        return;
      }
      const id = await repo.create(me, parsed, courtName, mine.area.point);
      // Alerts for new posts: near the post, level fits, at most 2 a day each.
      const candidates = await repo.alertCandidates(new Date(now.getTime() - 24 * 3_600_000));
      const to: string[] = [];
      // A new post has only the poster in it, so a block with the poster is the only one to check.
      const recipients = alertRecipients({ poster: me, point: mine.area.point, minRating: parsed.minRating, maxRating: parsed.maxRating }, candidates);
      const blocked = await repo.blockedAmong(me, recipients);
      to.push(...recipients.filter((who) => !blocked.has(who)));
      await repo.logAlerts(to, id);
      const label = windowLabel(parsed.startsAt, parsed.endsAt, parsed.timeZone);
      notify(to, "New open match near you", `${parsed.format === "doubles" ? `Doubles, need ${parsed.spots}` : "Singles"} · ${label}${courtName ? ` · ${courtName}` : ""}`);
      const m = await repo.one(id);
      res.status(201).json(await detail(m!, me));
    } catch (err) {
      fail(res, err, "Open match post failed", "Couldn't post your match. Try again.");
    }
  });

  router.get("/open-matches/:id", requireAuth, async (req, res) => {
    const me = getAuth(req).userId!;
    try {
      const m = await repo.one(Number(req.params.id));
      const everyone = m ? [m.posterClerkUserId, ...m.joined] : [];
      // Someone outside the match never sees it if they have a block with anyone in it.
      // Players already in keep their view (blocked players are left out of it in detail()).
      if (!m || m.status === "canceled" || (!everyone.includes(me) && (await repo.blockedAmong(me, everyone)).size > 0)) {
        res.status(404).json({ error: "This match isn't open any more." });
        return;
      }
      res.json(await detail(m, me));
    } catch (err) {
      fail(res, err, "Open match failed", "Can't load this match right now.");
    }
  });

  router.post("/open-matches/:id/:action", requireAuth, async (req, res) => {
    const me = getAuth(req).userId!;
    const id = Number(req.params.id);
    const action = String(req.params.action);
    const now = clock();
    try {
      const m = await repo.one(id);
      if (!m || m.status === "canceled") {
        res.status(404).json({ error: "This match isn't open any more." });
        return;
      }
      const meName = (await repo.people([me])).get(me)?.name ?? "A player";
      const everyone = [m.posterClerkUserId, ...m.joined];
      switch (action) {
        case "join": {
          // The repo checks blocks with the poster and everyone already in, under the join lock.
          const result = await repo.join(id, me, now);
          if (result === "blocked") {
            res.status(404).json({ error: NOT_AVAILABLE, code: "unavailable" });
            return;
          }
          if (result === "full") {
            res.status(409).json({ error: SPOT_FILLED, code: "filled" });
            return;
          }
          if (result === "closed") {
            res.status(409).json({ error: "This match has started or isn't open any more.", code: "closed" });
            return;
          }
          if (result === "own") {
            res.status(400).json({ error: "This is your post." });
            return;
          }
          if (result === "filled") {
            const after = (await repo.one(id))!;
            await repo.send(id, null, `All ${after.spots + 1} spots filled. ${windowLabel(after.startsAt, after.endsAt, after.timeZone)}${after.courtName ? ` · ${after.courtName}` : ""}. It's on everyone's schedule.`);
            notify(
              [after.posterClerkUserId, ...after.joined].filter((x) => x !== me),
              `${chatTitle(after)} is full`,
              "Your group chat is open. Say hi and settle the details.",
            );
          } else if (result === "joined") {
            notify([m.posterClerkUserId], `${meName} joined your open match`, `${windowLabel(m.startsAt, m.endsAt, m.timeZone)}. ${spotsLeft(m) - 1} left.`);
          }
          res.json(await detail((await repo.one(id))!, me));
          return;
        }
        case "drop": {
          if (!m.joined.includes(me) || now >= m.startsAt) {
            res.status(409).json({ error: "You're not in this match." });
            return;
          }
          await repo.leave(id, me, "dropped", now);
          if (m.status === "full") await repo.send(id, null, `${meName} dropped out. Their spot is open again in Discover.`);
          notify([m.posterClerkUserId], `${meName} dropped out`, `${windowLabel(m.startsAt, m.endsAt, m.timeZone)}. Their spot is open again.`);
          res.json(await detail((await repo.one(id))!, me));
          return;
        }
        case "remove": {
          const userId = Number((req.body ?? {}).userId);
          const people = await repo.people(m.joined);
          const target = [...people.entries()].find(([, p]) => p.userId === userId)?.[0];
          if (m.posterClerkUserId !== me || !target) {
            res.status(403).json({ error: "Only the player who posted it can do that." });
            return;
          }
          await repo.leave(id, target, "removed", now);
          await repo.send(id, null, `${people.get(target)?.name ?? "A player"} is out. Their spot is open again in Discover.`);
          // They only ever hear that it filled up (brief item 43).
          notify([target], "This match filled up", `${windowLabel(m.startsAt, m.endsAt, m.timeZone)} is full. Here are other open matches near you.`);
          res.json(await detail((await repo.one(id))!, me));
          return;
        }
        case "cancel": {
          if (m.posterClerkUserId !== me) {
            res.status(403).json({ error: "Only the player who posted it can cancel it." });
            return;
          }
          await repo.cancel(id, now);
          if (m.status === "full") await repo.send(id, null, `${meName} canceled this match. It's off everyone's schedule.`);
          notify(m.joined, `${meName} canceled an open match`, `${windowLabel(m.startsAt, m.endsAt, m.timeZone)} is off.`);
          res.json({ canceled: true });
          return;
        }
        case "messages": {
          if (!everyone.includes(me) || m.status !== "full") {
            res.status(403).json({ error: "The group chat opens when every spot is filled." });
            return;
          }
          const text = typeof (req.body ?? {}).text === "string" ? (req.body.text as string).trim().slice(0, 2000) : "";
          if (!text) {
            res.status(400).json({ error: "Type a message first." });
            return;
          }
          const msg = await repo.send(id, me, text);
          const blocked = await repo.blockedAmong(me, everyone);
          notify(everyone.filter((x) => x !== me && !blocked.has(x)), chatTitle(m), `${meName}: ${text.slice(0, 120)}`);
          res.status(201).json({ id: msg.id, text: msg.text, at: msg.createdAt.toISOString(), fromMe: true, senderName: "You", senderUserId: null });
          return;
        }
        default:
          res.status(404).json({ error: "Not found" });
      }
    } catch (err) {
      fail(res, err, "Open match action failed", "Couldn't do that. Try again.");
    }
  });

  router.get("/open-matches/:id/messages", requireAuth, async (req, res) => {
    const me = getAuth(req).userId!;
    try {
      const m = await repo.one(Number(req.params.id));
      if (!m || ![m.posterClerkUserId, ...m.joined].includes(me)) {
        res.status(404).json({ error: "This group chat isn't yours." });
        return;
      }
      const after = Number((req.query as Record<string, unknown>).after) || 0;
      // Messages from anyone you have a block with (either way) are left out of your view.
      const all = await repo.messages(m.id, after);
      const blocked = await repo.blockedAmong(me, [...new Set(all.map((r) => r.senderClerkUserId).filter((x): x is string => !!x))]);
      const rows = all.filter((r) => !r.senderClerkUserId || !blocked.has(r.senderClerkUserId));
      const people = await repo.people([...new Set(rows.map((r) => r.senderClerkUserId).filter((x): x is string => !!x))]);
      res.json({
        open: m.status === "full",
        messages: rows.map((r) => ({
          id: r.id,
          text: r.text,
          at: r.createdAt.toISOString(),
          fromMe: r.senderClerkUserId === me,
          senderName: r.senderClerkUserId == null ? null : r.senderClerkUserId === me ? "You" : (people.get(r.senderClerkUserId)?.name ?? "Player"),
          senderUserId: r.senderClerkUserId ? (people.get(r.senderClerkUserId)?.userId ?? null) : null,
        })),
      });
    } catch (err) {
      fail(res, err, "Group chat failed", "Can't load the group chat right now.");
    }
  });

  return router;
}

export default createOpenMatchesRouter();
