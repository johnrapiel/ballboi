import type { NextFunction, Request, Response } from "express";
import { getAuth } from "@clerk/express";
import { getLeagueRole } from "../lib/leagueAccess.js";

/**
 * Lets the request through only for an admin (owner or co-admin) of the league
 * in `:leagueId`. Sets `res.locals.leagueId` and `res.locals.leagueRole`.
 */
export async function requireLeagueAdmin(req: Request, res: Response, next: NextFunction): Promise<void> {
  const { userId } = getAuth(req);
  if (!userId) {
    res.status(401).json({ error: "Unauthorized" });
    return;
  }
  const leagueId = parseInt(String(req.params.leagueId));
  if (isNaN(leagueId)) {
    res.status(400).json({ error: "Invalid league ID" });
    return;
  }
  try {
    const role = await getLeagueRole(leagueId, userId);
    if (!role) {
      res.status(403).json({ error: "Only this league's admins can do that" });
      return;
    }
    res.locals.leagueId = leagueId;
    res.locals.leagueRole = role;
    next();
  } catch {
    res.status(500).json({ error: "Couldn't check your league role" });
  }
}
