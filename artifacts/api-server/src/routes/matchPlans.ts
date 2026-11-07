import { Router, type IRouter, type NextFunction, type Request, type Response } from "express";
import { getAuth } from "@clerk/express";
import { devToolsAllowed } from "../lib/devTime.js";
import { logger } from "../lib/logger.js";
import { pairKeyOf, parseNewPlan, planEvents, refusal, type PlanCommand } from "../lib/matchPlan.js";
import { DrizzleMatchPlanRepo, type MatchPlanRepo, type PlanRow } from "../lib/matchPlanRepo.js";
import { getMessagingService } from "../messaging/index.js";
import { sendPushToUsers } from "./notifications.js";

// Setting up a match in chat (F2; brief items 27 to 37). Cards live with the
// pair of players, so they show in your chat with each other whichever way
// it was opened. Free, never Pro.
// - GET  /match-plans/with/:userId        the cards and what you can do with each
// - POST /match-plans                     send a card { userId, startsAt, timeZone, courtId, kind }
// - POST /match-plans/:id/:command        accept, decline, undo, still-on, cancel,
//                                         not-played, no-show, dispute, admit
// - GET  /match-plans/upcoming            your added matches, for Home and My matches
// - POST /dev/match-plans/:id/shift       dev only: move a match closer in time

export type Push = (userIds: string[], title: string, body: string, link?: string) => Promise<void>;

/** Makes sure the two players have a chat, so a card sent from a player card lands in Messages. */
export type EnsureChat = (me: string, otherUserId: number, text: string) => Promise<void>;

const ensureChatViaMessages: EnsureChat = async (me, otherUserId, text) => {
  const svc = getMessagingService();
  if (await svc.conversationWithUser(me, otherUserId)) return;
  await svc.start(me, { userId: otherUserId, text, clientMessageId: `match-card-${Date.now()}` });
};

function requireAuth(req: Request, res: Response, next: NextFunction) {
  if (!getAuth(req).userId) {
    res.status(401).json({ error: "Unauthorized" });
    return;
  }
  next();
}

/** "Thu, Nov 12 at 6:00 PM" in the card's time zone. */
export function whenLabel(d: Date, timeZone: string): string {
  const day = d.toLocaleDateString("en-US", { weekday: "short", month: "short", day: "numeric", timeZone });
  const time = d.toLocaleTimeString("en-US", { hour: "numeric", minute: "2-digit", timeZone });
  return `${day} at ${time}`;
}

const COMMANDS: Record<string, PlanCommand> = {
  accept: "accept",
  decline: "decline",
  undo: "undo",
  "still-on": "still_on",
  cancel: "cancel",
  "not-played": "not_played",
  "no-show": "no_show",
  dispute: "dispute",
  admit: "admit",
};

export function createMatchPlansRouter(
  repo: MatchPlanRepo = new DrizzleMatchPlanRepo(),
  push: Push = sendPushToUsers,
  clock: () => Date = () => new Date(),
  ensureChat: EnsureChat = ensureChatViaMessages,
): IRouter {
  const router: IRouter = Router();

  const fail = (res: Response, err: unknown, what: string, message: string) => {
    logger.error({ err }, what);
    res.status(500).json({ error: message });
  };
  const notify = (to: string, title: string, body: string) => {
    push([to], title, body, "/messages").catch((err) => logger.warn({ err }, "Match card push failed"));
  };

  const view = (r: PlanRow, me: string, now: Date) => ({
    id: r.plan.id,
    startsAt: r.plan.startsAt.toISOString(),
    timeZone: r.plan.timeZone,
    courtName: r.plan.courtName,
    kind: r.plan.kind === "practice" ? "practice" : "singles",
    matchId: r.match.matchId,
    score: r.match.score,
    mine: r.plan.proposerClerkUserId === me,
    events: planEvents(r.plan, r.match, me, now),
  });

  router.get("/match-plans/with/:userId", requireAuth, async (req, res) => {
    const me = getAuth(req).userId!;
    const userId = Number(req.params.userId);
    try {
      const other = Number.isInteger(userId) ? await repo.accountForUser(userId) : null;
      if (!other || other.clerkUserId === me) {
        res.status(404).json({ error: "This player isn't on Ball Boi any more." });
        return;
      }
      const now = clock();
      const rows = await repo.forPair(me, other.clerkUserId);
      res.json({
        otherName: other.name,
        blocked: await repo.isBlocked(me, other.clerkUserId),
        devTools: devToolsAllowed(),
        plans: rows.map((r) => view(r, me, now)),
      });
    } catch (err) {
      fail(res, err, "Match cards failed", "Can't load match cards right now.");
    }
  });

  router.get("/match-plans/upcoming", requireAuth, async (req, res) => {
    const me = getAuth(req).userId!;
    try {
      const now = clock();
      // Matches still to play, and ones that just ended without a score.
      const rows = await repo.upcomingFor(me, new Date(now.getTime() - 3 * 3_600_000));
      const out = [];
      for (const r of rows.filter((x) => !x.match.score)) {
        const other = r.plan.proposerClerkUserId === me ? r.plan.recipientClerkUserId : r.plan.proposerClerkUserId;
        out.push({ ...view(r, me, now), otherName: await repo.name(other), otherUserId: await repo.userIdOf(other) });
      }
      res.json({ matches: out });
    } catch (err) {
      fail(res, err, "Upcoming Discover matches failed", "Can't load your matches right now.");
    }
  });

  router.post("/match-plans", requireAuth, async (req, res) => {
    const me = getAuth(req).userId!;
    const now = clock();
    const userId = Number((req.body ?? {}).userId);
    const parsed = parseNewPlan(req.body, now);
    if ("error" in parsed) {
      res.status(400).json({ error: parsed.error });
      return;
    }
    try {
      const other = Number.isInteger(userId) ? await repo.accountForUser(userId) : null;
      if (!other || other.clerkUserId === me) {
        res.status(404).json({ error: "This player isn't on Ball Boi any more." });
        return;
      }
      if (await repo.isBlocked(me, other.clerkUserId)) {
        res.status(403).json({ error: "You can't set up matches with this player.", code: "blocked" });
        return;
      }
      const courtName = parsed.courtId ? await repo.courtName(parsed.courtId) : null;
      if (parsed.courtId && !courtName) {
        res.status(400).json({ error: "That court isn't in the directory any more. Pick another." });
        return;
      }
      const plan = await repo.create(me, other.clerkUserId, parsed, courtName);
      // A first card with no chat yet opens one, so it shows in both players' Messages.
      await ensureChat(me, userId, `I sent you a match card for ${whenLabel(plan.startsAt, plan.timeZone)}. Tap I'm in to add it to both our schedules.`).catch(
        (err) => logger.warn({ err }, "Couldn't open a chat for a match card"),
      );
      const myName = await repo.name(me);
      notify(other.clerkUserId, `${myName} sent a match`, `Add this match? ${whenLabel(plan.startsAt, plan.timeZone)}${courtName ? ` at ${courtName}` : ""}`);
      const row = await repo.one(plan.id);
      res.status(201).json(view(row!, me, now));
    } catch (err) {
      fail(res, err, "Match card send failed", "Couldn't send the match card. Try again.");
    }
  });

  router.post("/match-plans/:id/:command", requireAuth, async (req, res) => {
    const me = getAuth(req).userId!;
    const id = Number(req.params.id);
    const cmd = COMMANDS[String(req.params.command)];
    if (!cmd || !Number.isInteger(id)) {
      res.status(404).json({ error: "Not found" });
      return;
    }
    try {
      const row = await repo.one(id);
      if (!row) {
        res.status(404).json({ error: "This match card isn't there any more." });
        return;
      }
      const { plan, match } = row;
      const now = clock();
      const other = plan.proposerClerkUserId === me ? plan.recipientClerkUserId : plan.proposerClerkUserId;
      if ((cmd === "accept" || cmd === "still_on") && (await repo.isBlocked(me, other))) {
        res.status(403).json({ error: "You can't set up matches with this player.", code: "blocked" });
        return;
      }
      const why = refusal(cmd, plan, match, me, now, await repo.latestProposedId(pairKeyOf(me, other)));
      if (why) {
        res.status(409).json({ error: why });
        return;
      }
      const myName = await repo.name(me);
      const when = whenLabel(plan.startsAt, plan.timeZone);
      switch (cmd) {
        case "accept":
          await repo.accept(id, now);
          notify(other, `${myName} is in`, `Match added: ${when}. It's on both your schedules.`);
          break;
        case "decline":
          await repo.update(id, { status: "declined", respondedAt: now });
          notify(other, `${myName} can't make it`, `${when} doesn't work. Send another time in your chat.`);
          break;
        case "undo":
        case "cancel":
          await repo.update(id, { status: cmd === "undo" ? "undone" : "canceled", endedAt: now, endedByClerkUserId: me });
          await repo.voidMatch(plan.matchId, now);
          notify(other, cmd === "undo" ? `${myName} undid the match` : `${myName} can't make it`, `${when} is off both your schedules.`);
          break;
        case "still_on":
          await repo.update(id, plan.proposerClerkUserId === me ? { proposerStillOnAt: now } : { recipientStillOnAt: now });
          break;
        case "not_played":
          await repo.update(id, { status: "not_played", endedAt: now, endedByClerkUserId: me });
          await repo.voidMatch(plan.matchId, now);
          break;
        case "no_show": {
          const deadline = new Date(now.getTime() + 48 * 3_600_000);
          await repo.update(id, { noShowReporterClerkUserId: me, noShowClerkUserId: other, noShowReportedAt: now, noShowStatus: "pending" });
          notify(other, `${myName} says you didn't show`, `For ${when}. If that's not right, tell us by ${whenLabel(deadline, plan.timeZone)}.`);
          break;
        }
        case "dispute":
          await repo.update(id, { noShowStatus: "disputed", noShowAnsweredAt: now });
          await repo.file({
            subject: me,
            planId: id,
            details: `Disputed no-show. ${await repo.name(plan.noShowReporterClerkUserId ?? other)} said ${myName} didn't show for ${when}; ${myName} said that's not right. Left off both player cards.`,
          });
          notify(other, "You two remember this differently", `So we've left the no-show for ${when} off both cards.`);
          break;
        case "admit":
          await repo.update(id, { noShowStatus: "confirmed", noShowAnsweredAt: now });
          break;
      }
      const after = await repo.one(id);
      res.json(view(after!, me, clock()));
    } catch (err) {
      fail(res, err, "Match card action failed", "Couldn't do that. Try again.");
    }
  });

  /** Dev only: move a match closer, so the day-before, reminder and "Did it happen?" steps can be tried now. */
  router.post("/dev/match-plans/:id/shift", requireAuth, async (req, res) => {
    if (!devToolsAllowed()) {
      res.status(404).json({ error: "Not found" });
      return;
    }
    const me = getAuth(req).userId!;
    const id = Number(req.params.id);
    const hours = Number((req.body ?? {}).hours);
    if (!Number.isFinite(hours) || hours <= 0 || hours > 24 * 60) {
      res.status(400).json({ error: "Send hours from 1 to 1440." });
      return;
    }
    const row = await repo.one(id);
    if (!row || (row.plan.proposerClerkUserId !== me && row.plan.recipientClerkUserId !== me)) {
      res.status(404).json({ error: "Not found" });
      return;
    }
    const shift = (d: Date | null) => (d ? new Date(d.getTime() - hours * 3_600_000) : d);
    const p = row.plan;
    await repo.update(id, {
      startsAt: shift(p.startsAt)!,
      createdAt: shift(p.createdAt)!,
      respondedAt: shift(p.respondedAt),
      noShowReportedAt: shift(p.noShowReportedAt),
    });
    const after = await repo.one(id);
    res.json(view(after!, me, clock()));
  });

  return router;
}

export default createMatchPlansRouter();
