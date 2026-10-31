import type { NextFunction, Request, Response } from "express";
import { getAuth } from "@clerk/express";
import { logger } from "../lib/logger";
import { getSanctionsService, identityFromClerk } from "./drizzleSanctions";
import type { AccountIdentity, SanctionsService } from "./sanctions";

// Keeps a banned or suspended person out of the API. The app checks
// /api/account/status right after sign-in and shows the blocked screen; this
// makes sure nothing else works either, whatever the app does.

/** Paths a sanctioned person can still use: their status, their one appeal, and deleting their account. */
const ALLOWED: { method: string; path: RegExp }[] = [
  { method: "GET", path: /^\/account\/status\/?$/ },
  { method: "POST", path: /^\/account\/appeal\/?$/ },
  { method: "DELETE", path: /^\/users\/me\/?$/ },
  { method: "GET", path: /^\/healthz?\/?$/ },
];

const IDENTITY_TTL = 10 * 60_000;
const RESULT_TTL = 60_000;

export function createSanctionsGate(deps: {
  getService: () => SanctionsService;
  getIdentity: (clerkUserId: string) => Promise<AccountIdentity>;
  now?: () => number;
}) {
  const now = deps.now ?? (() => Date.now());
  const identities = new Map<string, { at: number; identity: AccountIdentity }>();
  const results = new Map<string, { at: number; blocked: "ban" | "suspend" | null }>();

  /** Identity from Clerk, cached; just the account id if Clerk can't be reached. */
  async function identityFor(clerkUserId: string): Promise<AccountIdentity> {
    const hit = identities.get(clerkUserId);
    if (hit && now() - hit.at < IDENTITY_TTL) return hit.identity;
    try {
      const identity = await deps.getIdentity(clerkUserId);
      identities.set(clerkUserId, { at: now(), identity });
      if (identities.size > 5000) identities.delete(identities.keys().next().value!);
      return identity;
    } catch {
      return { clerkUserId, appleUserId: null, emails: [] };
    }
  }

  async function blockedKind(clerkUserId: string): Promise<"ban" | "suspend" | null> {
    const hit = results.get(clerkUserId);
    if (hit && now() - hit.at < RESULT_TTL) return hit.blocked;
    const svc = deps.getService();
    let blocked: "ban" | "suspend" | null = null;
    if (!(await svc.noneActive())) {
      const s = await svc.current(await identityFor(clerkUserId));
      blocked = s ? (s.kind as "ban" | "suspend") : null;
    }
    results.set(clerkUserId, { at: now(), blocked });
    if (results.size > 5000) results.delete(results.keys().next().value!);
    return blocked;
  }

  const middleware = async (req: Request, res: Response, next: NextFunction) => {
    const userId = getAuth(req).userId;
    if (!userId || ALLOWED.some((a) => a.method === req.method && a.path.test(req.path))) {
      next();
      return;
    }
    try {
      const blocked = await blockedKind(userId);
      if (blocked) {
        res.status(403).json({
          code: blocked === "ban" ? "account_banned" : "account_suspended",
          error: blocked === "ban" ? "This account is banned." : "This account is suspended.",
        });
        return;
      }
    } catch (err) {
      // The sanctions check never takes the whole API down.
      logger.error({ err }, "Sanctions check failed");
    }
    next();
  };

  /** Forget cached results, so a new ban or a lift takes effect at once. */
  const clear = () => {
    results.clear();
    identities.clear();
  };

  return { middleware, clear };
}

const gate = createSanctionsGate({ getService: getSanctionsService, getIdentity: identityFromClerk });

/** Mounted on /api in app.ts, after clerkMiddleware. */
export const enforceSanctions = gate.middleware;
export const clearSanctionsCache = gate.clear;
