import {
  Router,
  type IRouter,
  type NextFunction,
  type Request,
  type Response,
} from "express";
import { getAuth } from "@clerk/express";

import { blockedAccountsFor } from "../lib/blocks.js";
import { DrizzleCourtRepo, type CourtRepo } from "../lib/courtRepo.js";
import { DrizzleDiscoverRepo, type DiscoverRepo } from "../lib/discoverRepo.js";
import { addDays, localDate } from "../lib/leagueCalendar.js";
import { logger } from "../lib/logger.js";
import {
  DrizzleMatchRequestRepo,
  type MatchRequest,
  type MatchRequestRepo,
  type RequestChange,
} from "../lib/matchRequestRepo.js";
import {
  DAILY_REQUEST_LIMIT,
  KIND_LABEL,
  actionsFor,
  dueReminders,
  otherPlayer,
  parseMatchRequest,
  parseWhen,
  phaseFor,
  startOf,
  whenLabel,
  type Action,
} from "../lib/matchRequests.js";
import { FirstMessageFilter } from "../messaging/filter.js";
import { sendPushToUsers } from "./notifications.js";

// Match requests (spec: Discover, "From found to playing": "Request holds
// date and time window, court, singles or practice hit, optional note.
// Recipient accepts, counters with a new time, or declines. Both players
// confirm the day before; reminder 2 hours out. Either player enters the
// score; the first score entered stands. Reliability shows on player cards").
// Accepting makes a match outside any league, so the score goes through
// POST /recording/quick-matches/:matchId/score like a Quick match.

export type Notify = (
  clerkUserIds: string[],
  title: string,
  body: string,
  link: string,
) => Promise<void>;

export interface MatchRequestDeps {
  requests: () => MatchRequestRepo;
  discover: () => DiscoverRepo;
  courts: () => CourtRepo;
  blocked: (viewer: string) => Promise<Set<string>>;
  notify: Notify;
  filter: FirstMessageFilter;
  now: () => Date;
}

const defaults = (): MatchRequestDeps => ({
  requests: () => new DrizzleMatchRequestRepo(),
  discover: () => new DrizzleDiscoverRepo(),
  courts: () => new DrizzleCourtRepo(),
  blocked: (viewer) => blockedAccountsFor(viewer),
  notify: sendPushToUsers,
  filter: FirstMessageFilter.fromEnv(),
  now: () => new Date(),
});

/** Finished requests drop off the list this long after their day. */
const KEEP_FINISHED_DAYS = 14;
const ACTIONS: Action[] = [
  "accept",
  "counter",
  "decline",
  "withdraw",
  "confirm",
  "cancel",
  "no_show",
];

function requireAuth(req: Request, res: Response, next: NextFunction) {
  if (!getAuth(req).userId) {
    res.status(401).json({ error: "Unauthorized" });
    return;
  }
  next();
}

/** A request as one of its players sees it. */
async function viewsFor(
  d: MatchRequestDeps,
  viewer: string,
  rows: MatchRequest[],
) {
  const repo = d.requests();
  const now = d.now();
  const others = [...new Set(rows.map((r) => otherPlayer(r, viewer)))];
  const [people, courts, scored] = await Promise.all([
    repo.people(others),
    repo.courtNames([
      ...new Set(
        rows.map((r) => r.courtId).filter((x): x is number => x != null),
      ),
    ]),
    repo.scored(
      rows.map((r) => r.matchId).filter((x): x is number => x != null),
    ),
  ]);
  return rows.map((r) => {
    const other = otherPlayer(r, viewer);
    const mineFrom = r.fromClerkUserId === viewer;
    const phase = phaseFor(r, viewer, now);
    const scoreEntered = r.matchId != null && scored.has(r.matchId);
    const actions = actionsFor(r, viewer, now).filter(
      (a) => !(a === "no_show" && scoreEntered),
    );
    return {
      requestId: r.id,
      phase,
      actions,
      kind: r.kind,
      when: whenLabel(r),
      date: r.date,
      windowStart: r.windowStart,
      windowEnd: r.windowEnd,
      timeZone: r.timeZone,
      startsAt: startOf(r).toISOString(),
      court:
        r.courtId != null && courts.has(r.courtId)
          ? { courtId: r.courtId, name: courts.get(r.courtId)! }
          : null,
      note: r.note,
      other: {
        userId: people.get(other)?.userId ?? null,
        name: people.get(other)?.name ?? "A player",
      },
      sentByMe: mineFrom,
      counters: r.counters,
      matchId: r.matchId,
      scoreEntered,
      youConfirmed: (mineFrom ? r.fromConfirmedAt : r.toConfirmedAt) != null,
      theyConfirmed: (mineFrom ? r.toConfirmedAt : r.fromConfirmedAt) != null,
      noShow:
        r.noShowClerkUserId == null
          ? null
          : r.noShowClerkUserId === viewer
            ? "you"
            : "them",
    };
  });
}

export function createMatchRequestsRouter(
  deps: Partial<MatchRequestDeps> = {},
): IRouter {
  const d: MatchRequestDeps = { ...defaults(), ...deps };
  const router: IRouter = Router();
  const wrap =
    (fn: (viewer: string, req: Request, res: Response) => Promise<void>) =>
    async (req: Request, res: Response) => {
      try {
        await fn(getAuth(req).userId!, req, res);
      } catch (err) {
        logger.error({ err }, "Match request failed");
        res.status(500).json({ error: "Something went wrong. Try again." });
      }
    };
  const push = (to: string, title: string, body: string, id: number) =>
    d
      .notify([to], title, body, `/match-requests/${id}`)
      .catch((err) => logger.warn({ err }, "Match request push failed"));

  /** A request this player is in and can still see (no block either way), or null. */
  const visible = async (viewer: string, id: number) => {
    if (!Number.isInteger(id)) return null;
    const r = await d.requests().byId(id);
    if (!r || (r.fromClerkUserId !== viewer && r.toClerkUserId !== viewer))
      return null;
    if ((await d.blocked(viewer)).has(otherPlayer(r, viewer))) return null;
    return r;
  };

  /** GET /match-requests: yours, sent and received, without finished ones from more than two weeks ago. */
  router.get(
    "/match-requests",
    requireAuth,
    wrap(async (viewer, _req, res) => {
      const [rows, blocked] = await Promise.all([
        d.requests().mine(viewer),
        d.blocked(viewer),
      ]);
      const cutoff = addDays(localDate(d.now(), "UTC"), -KEEP_FINISHED_DAYS);
      const kept = rows.filter(
        (r) =>
          !blocked.has(otherPlayer(r, viewer)) &&
          (r.date >= cutoff ||
            r.status === "pending" ||
            r.status === "accepted"),
      );
      res.json({ requests: await viewsFor(d, viewer, kept) });
    }),
  );

  router.get(
    "/match-requests/:requestId",
    requireAuth,
    wrap(async (viewer, req, res) => {
      const r = await visible(viewer, Number(req.params.requestId));
      if (!r) {
        res
          .status(404)
          .json({ error: "This match request isn't here anymore." });
        return;
      }
      res.json((await viewsFor(d, viewer, [r]))[0]);
    }),
  );

  /** POST /match-requests: ask a Discover player for a match. */
  router.post(
    "/match-requests",
    requireAuth,
    wrap(async (viewer, req, res) => {
      const input = parseMatchRequest(
        req.body,
        (t) => d.filter.check(t).ok,
        d.now(),
      );
      if ("error" in input) {
        res.status(400).json({ error: input.error });
        return;
      }
      const them = await d.discover().person(viewer, input.toUserId);
      if (!them) {
        res
          .status(404)
          .json({ error: "This player isn't in Discover right now." });
        return;
      }
      const repo = d.requests();
      const open = (await repo.openBetween(viewer, them.clerkUserId)).filter(
        (r) => startOf(r).getTime() > d.now().getTime(),
      );
      if (open.length) {
        res
          .status(409)
          .json({
            error: `You already have a match request with ${them.name}. Answer or withdraw it first.`,
            requestId: open[0].id,
          });
        return;
      }
      if (
        (await repo.sentSince(
          viewer,
          new Date(d.now().getTime() - 24 * 3600_000),
        )) >= DAILY_REQUEST_LIMIT
      ) {
        res
          .status(429)
          .json({
            error: `You can send ${DAILY_REQUEST_LIMIT} match requests a day. Try again tomorrow.`,
          });
        return;
      }
      if (input.courtId != null && !(await d.courts().byId(input.courtId))) {
        res
          .status(400)
          .json({
            error: "That court isn't in the directory anymore. Pick another.",
          });
        return;
      }
      const { toUserId: _to, ...rest } = input;
      const created = await repo.create(viewer, them.clerkUserId, rest);
      const [view] = await viewsFor(d, viewer, [created]);
      const myName =
        (await repo.people([viewer])).get(viewer)?.name ?? "A player";
      void push(
        them.clerkUserId,
        `Match request from ${myName}`,
        `${KIND_LABEL[created.kind]}, ${view.when}${view.court ? ` at ${view.court.name}` : ""}.`,
        created.id,
      );
      res.status(201).json(view);
    }),
  );

  /** POST /match-requests/:id/{accept|counter|decline|withdraw|confirm|cancel|no-show}. */
  for (const action of ACTIONS)
    router.post(
      `/match-requests/:requestId/${action.replace("_", "-")}`,
      requireAuth,
      wrap(async (viewer, req, res) => {
        const r = await visible(viewer, Number(req.params.requestId));
        if (!r) {
          res
            .status(404)
            .json({ error: "This match request isn't here anymore." });
          return;
        }
        const repo = d.requests();
        const now = d.now();
        if (!actionsFor(r, viewer, now).includes(action)) {
          res
            .status(409)
            .json({
              error: "This match request has changed. Pull to refresh.",
            });
          return;
        }
        const other = otherPlayer(r, viewer);
        const mineFrom = r.fromClerkUserId === viewer;
        let change: RequestChange;
        switch (action) {
          case "accept":
            change = { status: "accepted" };
            break;
          case "counter": {
            const when = parseWhen(
              (req.body ?? {}) as Record<string, unknown>,
              r.timeZone,
              now,
            );
            if ("error" in when) {
              res.status(400).json({ error: when.error });
              return;
            }
            change = {
              ...when,
              waitingOnClerkUserId: other,
              counters: r.counters + 1,
            };
            break;
          }
          case "decline":
            change = { status: "declined" };
            break;
          case "withdraw":
            change = { status: "withdrawn" };
            break;
          case "confirm":
            change = mineFrom
              ? { fromConfirmedAt: now }
              : { toConfirmedAt: now };
            break;
          case "cancel":
            change = { status: "cancelled", cancelledByClerkUserId: viewer };
            break;
          case "no_show":
            if (
              r.matchId != null &&
              (await repo.scored([r.matchId])).has(r.matchId)
            ) {
              res
                .status(409)
                .json({
                  error: "A score is in for this match, so it was played.",
                });
              return;
            }
            change = { noShowClerkUserId: other };
            break;
        }
        let saved = await repo.update(r, change);
        if (!saved) {
          res
            .status(409)
            .json({
              error: "This match request has changed. Pull to refresh.",
            });
          return;
        }
        if (action === "accept") {
          const court =
            r.courtId != null
              ? ((await repo.courtNames([r.courtId])).get(r.courtId) ?? null)
              : null;
          const matchId = await repo.makeMatch(
            r.fromClerkUserId,
            r.toClerkUserId,
            startOf(r),
            court,
          );
          saved = (await repo.update(saved, { matchId })) ?? {
            ...saved,
            matchId,
          };
        }
        if (action === "cancel" && r.matchId != null)
          await repo.cancelMatch(r.matchId);

        const [view] = await viewsFor(d, viewer, [saved]);
        const name =
          (await repo.people([viewer])).get(viewer)?.name ?? "A player";
        const when = whenLabel(saved);
        const at = view.court ? ` at ${view.court.name}` : "";
        if (action === "accept")
          void push(
            other,
            `${name} accepted your match request`,
            `${when}${at}. You'll both confirm the day before.`,
            r.id,
          );
        if (action === "counter")
          void push(
            other,
            `${name} suggested a new time`,
            `${when}${at}. Accept it or suggest another.`,
            r.id,
          );
        if (action === "decline")
          void push(
            other,
            `${name} can't make it`,
            `They declined your match request for ${when}.`,
            r.id,
          );
        if (action === "cancel")
          void push(
            other,
            `${name} cancelled your match`,
            `${when} is off.`,
            r.id,
          );
        if (action === "confirm")
          void push(other, `${name} confirmed`, `${when}${at} is on.`, r.id);
        res.json(view);
      }),
    );

  return router;
}

/**
 * The day-before confirm prompt and the 2-hour reminder for accepted match
 * requests. Each push is claimed before it's sent, so it goes at most once.
 * When both are due at once (a match accepted for later today), only the
 * reminder goes.
 */
export async function runMatchRequestReminders(
  deps: Partial<MatchRequestDeps> = {},
): Promise<number> {
  const d: MatchRequestDeps = { ...defaults(), ...deps };
  const repo = d.requests();
  const now = d.now();
  const today = localDate(now, "UTC");
  const rows = await repo.acceptedAround(addDays(today, -1), addDays(today, 2));
  const due = dueReminders(rows, now);
  const byId = new Map(rows.map((r) => [r.id, r]));
  const people = await repo.people([
    ...new Set(rows.flatMap((r) => [r.fromClerkUserId, r.toClerkUserId])),
  ]);
  const courts = await repo.courtNames([
    ...new Set(
      rows.map((r) => r.courtId).filter((x): x is number => x != null),
    ),
  ]);
  const nameOf = (id: string) => people.get(id)?.name ?? "your opponent";
  let sent = 0;

  for (const id of due.remind) {
    const r = byId.get(id)!;
    if (due.confirm.includes(id)) await repo.claim(id, "confirmPromptSentAt");
    if (!(await repo.claim(id, "reminderSentAt"))) continue;
    const at =
      r.courtId != null && courts.has(r.courtId)
        ? `At ${courts.get(r.courtId)}. `
        : "";
    for (const [me, them] of [
      [r.fromClerkUserId, r.toClerkUserId],
      [r.toClerkUserId, r.fromClerkUserId],
    ]) {
      await d.notify(
        [me],
        `Match with ${nameOf(them)} soon`,
        `${whenLabel(r)}. ${at}Enter the score after you play.`,
        `/match-requests/${id}`,
      );
    }
    sent++;
  }
  for (const id of due.confirm) {
    if (due.remind.includes(id)) continue;
    const r = byId.get(id)!;
    if (!(await repo.claim(id, "confirmPromptSentAt"))) continue;
    for (const [me, them] of [
      [r.fromClerkUserId, r.toClerkUserId],
      [r.toClerkUserId, r.fromClerkUserId],
    ]) {
      await d.notify(
        [me],
        "Still on for tomorrow?",
        `Confirm your match with ${nameOf(them)}, ${whenLabel(r)}.`,
        `/match-requests/${id}`,
      );
    }
    sent++;
  }
  return sent;
}

export default createMatchRequestsRouter();
