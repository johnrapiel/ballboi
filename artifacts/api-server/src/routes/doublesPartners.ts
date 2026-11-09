import { Router, type IRouter, type Request, type Response } from "express";
import { getAuth } from "@clerk/express";
import { getLeagueRole } from "../lib/leagueAccess.js";
import { logger } from "../lib/logger.js";
import { getDoublesPartners, PartnersError, type DoublesPartnersService } from "../services/doublesPartners.js";
import { openDoublesMatchChat, DoublesChatError } from "../services/doublesChat.js";

// Doubles partners and the doubles match chat (doubles flow review, John, Nov 9).
// Members (D9):
// - GET  /leagues/:leagueId/partner                         your partner, requests, notice, who you can ask
// - POST /leagues/:leagueId/partner/requests { toPlayerId } "Team up with someone"
// - POST /leagues/:leagueId/partner/requests/:id/accept|decline|cancel|dismiss
// - POST /leagues/:leagueId/partner/looking { on }          "Find me a partner"
// Admins (D2, D4):
// - GET  /leagues/:leagueId/teams                           Manage > Teams
// - POST /leagues/:leagueId/teams { playerIds: [a, b] }     team up
// - POST /leagues/:leagueId/teams/:teamId/split             split
// The four players (D6):
// - POST /leagues/:leagueId/matches/:matchId/chat           the match's group chat, made if needed

export interface DoublesRouterDeps {
  service: () => Promise<DoublesPartnersService>;
  isAdmin: (leagueId: number, userId: string) => Promise<boolean>;
  openChat: (leagueId: number, matchId: number, userId: string) => Promise<{ groupId: number }>;
}

const defaults: DoublesRouterDeps = {
  service: getDoublesPartners,
  isAdmin: async (leagueId, userId) => (await getLeagueRole(leagueId, userId)) !== null,
  openChat: openDoublesMatchChat,
};

const id = (v: unknown) => {
  const n = parseInt(String(v));
  return Number.isInteger(n) && n > 0 ? n : null;
};

export function createDoublesPartnersRouter(deps: DoublesRouterDeps = defaults): IRouter {
  const router: IRouter = Router();

  const run =
    (admin: boolean, fn: (s: DoublesPartnersService, leagueId: number, me: string, req: Request) => Promise<unknown>) =>
    async (req: Request, res: Response) => {
      const me = getAuth(req).userId;
      if (!me) { res.status(401).json({ error: "Unauthorized" }); return; }
      const leagueId = id(req.params.leagueId);
      if (!leagueId) { res.status(400).json({ error: "Invalid league ID" }); return; }
      try {
        if (admin && !(await deps.isAdmin(leagueId, me))) { res.status(403).json({ error: "Only this league's admins can do that" }); return; }
        res.json(await fn(await deps.service(), leagueId, me, req));
      } catch (err) {
        if (err instanceof PartnersError) { res.status(err.status).json({ error: err.message }); return; }
        logger.error({ err, leagueId }, "Doubles partners request failed");
        res.status(500).json({ error: "Something went wrong. Try again." });
      }
    };

  const requestId = (req: Request) => {
    const r = id(req.params.requestId);
    if (!r) throw new PartnersError(400, "Invalid request ID");
    return r;
  };

  router.get("/leagues/:leagueId/partner", run(false, (s, l, me) => s.mine(l, me)));
  router.post(
    "/leagues/:leagueId/partner/requests",
    run(false, (s, l, me, req) => {
      const to = id(req.body?.toPlayerId);
      if (!to) throw new PartnersError(400, "Pick someone to team up with.");
      return s.request(l, me, to);
    }),
  );
  router.post("/leagues/:leagueId/partner/requests/:requestId/accept", run(false, (s, l, me, req) => s.respond(l, me, requestId(req), true)));
  router.post("/leagues/:leagueId/partner/requests/:requestId/decline", run(false, (s, l, me, req) => s.respond(l, me, requestId(req), false)));
  router.post("/leagues/:leagueId/partner/requests/:requestId/cancel", run(false, (s, l, me, req) => s.cancel(l, me, requestId(req))));
  router.post("/leagues/:leagueId/partner/requests/:requestId/dismiss", run(false, (s, l, me, req) => s.dismissNotice(l, me, requestId(req))));
  router.post(
    "/leagues/:leagueId/partner/looking",
    run(false, (s, l, me, req) => {
      if (typeof req.body?.on !== "boolean") throw new PartnersError(400, "Say whether you're looking for a partner.");
      return s.setLooking(l, me, req.body.on);
    }),
  );

  router.get("/leagues/:leagueId/teams", run(true, (s, l) => s.manage(l)));
  router.post(
    "/leagues/:leagueId/teams",
    run(true, (s, l, _me, req) => {
      const ids = Array.isArray(req.body?.playerIds) ? req.body.playerIds.map(id) : [];
      if (ids.length !== 2 || ids.some((x: number | null) => x == null)) throw new PartnersError(400, "Pick two players to team up.");
      return s.teamUp(l, ids[0]!, ids[1]!);
    }),
  );
  router.post(
    "/leagues/:leagueId/teams/:teamId/split",
    run(true, (s, l, _me, req) => {
      const teamId = id(req.params.teamId);
      if (!teamId) throw new PartnersError(400, "Invalid team ID");
      return s.split(l, teamId);
    }),
  );

  router.post("/leagues/:leagueId/matches/:matchId/chat", async (req, res) => {
    const me = getAuth(req).userId;
    if (!me) { res.status(401).json({ error: "Unauthorized" }); return; }
    const leagueId = id(req.params.leagueId);
    const matchId = id(req.params.matchId);
    if (!leagueId || !matchId) { res.status(400).json({ error: "Invalid id" }); return; }
    try {
      res.json(await deps.openChat(leagueId, matchId, me));
    } catch (err) {
      if (err instanceof DoublesChatError) { res.status(err.status).json({ error: err.message }); return; }
      logger.error({ err, leagueId, matchId }, "Doubles match chat failed");
      res.status(500).json({ error: "The chat didn't open. Try again." });
    }
  });

  return router;
}

export default createDoublesPartnersRouter();
