import type { NextFunction, Request, Response } from "express";
import { getAuth } from "@clerk/express";
import { db, leaguesTable } from "@workspace/db";
import { eq } from "drizzle-orm";
import { canViewLeague, PRIVATE_LEAGUE } from "../lib/leagueAccess.js";

/**
 * Lets the request through only for someone signed in who can see the league
 * in `:leagueId`: anyone signed in for an Open league, only its players and
 * admins for a Private one. Sets `res.locals.leagueId`.
 */
export async function requireLeagueViewer(req: Request, res: Response, next: NextFunction): Promise<void> {
  const { userId } = getAuth(req);
  if (!userId) { res.status(401).json({ error: "Unauthorized" }); return; }
  const leagueId = parseInt(String(req.params.leagueId));
  if (isNaN(leagueId)) { res.status(400).json({ error: "Invalid league ID" }); return; }
  try {
    const [league] = await db
      .select({ id: leaguesTable.id, visibility: leaguesTable.visibility, createdByClerkUserId: leaguesTable.createdByClerkUserId })
      .from(leaguesTable)
      .where(eq(leaguesTable.id, leagueId));
    if (!league) { res.status(404).json({ error: "League not found" }); return; }
    if (!(await canViewLeague(league, userId))) { res.status(403).json({ error: PRIVATE_LEAGUE }); return; }
    res.locals.leagueId = leagueId;
    next();
  } catch {
    res.status(500).json({ error: "Couldn't check your access to this league" });
  }
}
