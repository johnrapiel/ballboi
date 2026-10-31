import { Router, type IRouter, type NextFunction, type Request, type Response } from "express";
import { getAuth } from "@clerk/express";
import { getSanctionsService, identityFromClerk, isAdminAccount, namesFor } from "../messaging/drizzleSanctions";
import { clearSanctionsCache } from "../messaging/enforceSanctions";
import { SanctionError, type AccountIdentity, type SanctionsService } from "../messaging/sanctions";
import { requireAdmin } from "../middlewares/requireAdmin";
import { logger } from "../lib/logger";

// Bans, suspensions and one appeal. Spec: Enforcement ladder steps 4 to 6.
// Mounted from routes/safety.ts.
//
// Person-facing (work even while banned; see messaging/enforceSanctions.ts):
//   GET  /api/account/status   what the app shows right after sign-in
//   POST /api/account/appeal   the one appeal; the app then opens an email to support
// Moderator-only (requireAdmin; the agent and auto-restrict can't reach these):
//   POST /api/admin/accounts/:clerkUserId/ban       { reason, reportId? }
//   POST /api/admin/accounts/:clerkUserId/suspend   { reason, days (1-90), reportId? }
//   POST /api/admin/sanctions/:id/lift
//   GET  /api/admin/sanctions?active=false
//   GET  /api/admin/appeals?open=false            (with the sanction and the person's name)
//   GET  /api/admin/me                            { admin } for showing Moderation in the app
//   POST /api/admin/appeals/:id/decide              { outcome: "upheld" | "overturned", note? }

function requireAuth(req: Request, res: Response, next: NextFunction) {
  if (!getAuth(req).userId) {
    res.status(401).json({ error: "Unauthorized" });
    return;
  }
  next();
}

export function createSanctionsRouter(
  deps: {
    getService?: () => SanctionsService;
    getIdentity?: (clerkUserId: string) => Promise<AccountIdentity>;
    admin?: (req: Request, res: Response, next: NextFunction) => void;
    onChange?: () => void;
    isAdmin?: (clerkUserId: string) => Promise<boolean>;
    getNames?: (clerkUserIds: string[]) => Promise<Map<string, string>>;
  } = {},
): IRouter {
  const getService = deps.getService ?? getSanctionsService;
  const getIdentity = deps.getIdentity ?? identityFromClerk;
  const admin = deps.admin ?? requireAdmin;
  const onChange = deps.onChange ?? clearSanctionsCache;
  const isAdmin = deps.isAdmin ?? isAdminAccount;
  const getNames = deps.getNames ?? namesFor;
  const router: IRouter = Router();

  const handle =
    (fn: (req: Request, res: Response) => Promise<void>) =>
    async (req: Request, res: Response): Promise<void> => {
      try {
        await fn(req, res);
      } catch (e) {
        if (e instanceof SanctionError) {
          res.status(e.status).json({ error: e.message, code: e.code });
          return;
        }
        logger.error({ err: e }, "Sanctions request failed");
        res.status(500).json({ error: "Something went wrong. Try again." });
      }
    };

  /** Clerk can be briefly unreachable; fall back to the account id alone. */
  const identityOf = async (clerkUserId: string): Promise<AccountIdentity> => {
    try {
      return await getIdentity(clerkUserId);
    } catch {
      return { clerkUserId, appleUserId: null, emails: [] };
    }
  };

  const idParam = (req: Request) => {
    const id = Number(req.params.id);
    if (!Number.isInteger(id) || id <= 0) throw new SanctionError(404, "not_found", "Not found.");
    return id;
  };

  // ─── The person ─────────────────────────────────────────────────────────

  router.get(
    "/account/status",
    requireAuth,
    handle(async (req, res) => {
      res.json(await getService().status(await identityOf(getAuth(req).userId!)));
    }),
  );

  router.post(
    "/account/appeal",
    requireAuth,
    handle(async (req, res) => {
      const result = await getService().appeal(await identityOf(getAuth(req).userId!));
      logger.warn({ reference: result.reference }, "Ban or suspension appealed");
      res.status(201).json(result);
    }),
  );

  // ─── Moderators ─────────────────────────────────────────────────────────

  /** Whether to show Moderation in the app. Any signed-in person can ask; only the admin gets true. */
  router.get(
    "/admin/me",
    requireAuth,
    handle(async (req, res) => {
      res.json({ admin: await isAdmin(getAuth(req).userId!) });
    }),
  );

  for (const kind of ["ban", "suspend"] as const) {
    router.post(
      `/admin/accounts/:clerkUserId/${kind}`,
      admin,
      handle(async (req, res) => {
        // Read the Apple ID and email now, so the ban also covers a new account made with them.
        const identity = await getIdentity(String(req.params.clerkUserId)).catch(() => {
          throw new SanctionError(404, "no_account", "That account wasn't found in Clerk.");
        });
        const sanction = await getService().sanction({
          kind,
          identity,
          reason: req.body?.reason,
          reportId: req.body?.reportId,
          days: req.body?.days,
          by: getAuth(req).userId ?? "admin",
        });
        onChange();
        res.status(201).json({ sanction });
      }),
    );
  }

  router.post(
    "/admin/sanctions/:id/lift",
    admin,
    handle(async (req, res) => {
      const sanction = await getService().lift(idParam(req), getAuth(req).userId ?? "admin");
      onChange();
      res.json({ sanction });
    }),
  );

  router.get(
    "/admin/sanctions",
    admin,
    handle(async (req, res) => {
      res.json(await getService().list(req.query.active !== "false"));
    }),
  );

  router.get(
    "/admin/appeals",
    admin,
    handle(async (req, res) => {
      const appeals = await getService().listAppealsWithSanctions(req.query.open !== "false");
      const names = await getNames(appeals.map((a) => a.clerkUserId));
      res.json(appeals.map((a) => ({ ...a, name: names.get(a.clerkUserId) ?? null })));
    }),
  );

  router.post(
    "/admin/appeals/:id/decide",
    admin,
    handle(async (req, res) => {
      const appeal = await getService().decideAppeal(idParam(req), {
        outcome: req.body?.outcome,
        note: req.body?.note,
        by: getAuth(req).userId ?? "admin",
      });
      onChange();
      res.json({ appeal });
    }),
  );

  return router;
}

export default createSanctionsRouter();
