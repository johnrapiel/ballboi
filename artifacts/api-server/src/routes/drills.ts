import { Router } from "express";
import { getAuth } from "@clerk/express";
import { db } from "@workspace/db";
import { sql } from "drizzle-orm";
import { logger } from "../lib/logger";
import { requireAdmin } from "../middlewares/requireAdmin";

const router = Router();

function requireAuth(req: any, res: any, next: any) {
  const { userId } = getAuth(req);
  if (!userId) return res.status(401).json({ error: "Unauthorized" });
  next();
}

// GET /drills/:leagueId — list drills for a league
router.get("/drills/:leagueId", requireAuth, async (req: any, res: any) => {
  try {
    const leagueId = parseInt(req.params.leagueId);
    const result = await db.execute(sql`
      SELECT d.*,
             COUNT(dr.id) as attempt_count,
             AVG(dr.success_percentage) as avg_success
      FROM drills d
      LEFT JOIN drill_results dr ON dr.drill_id = d.id
      WHERE d.league_id = ${leagueId} AND d.is_active = true
      GROUP BY d.id
      ORDER BY d.created_at DESC
    `);
    res.json(result.rows);
  } catch (err) {
    res.status(500).json({ error: "Failed to fetch drills" });
  }
});

// POST /drills — create a drill (admin)
router.post("/drills", requireAdmin, async (req: any, res: any) => {
  try {
    const { userId } = getAuth(req);
    const { leagueId, name, description, instructions, drillType = "custom",
      targetShotType, targetZone, targetShotCount = 20 } = req.body;

    if (!leagueId || !name) return res.status(400).json({ error: "leagueId and name required" });

    const result = await db.execute(sql`
      INSERT INTO drills (league_id, creator_id, name, description, instructions,
        drill_type, target_shot_type, target_zone, target_shot_count)
      VALUES (${leagueId}, ${userId}, ${name}, ${description ?? null}, ${instructions ?? null},
        ${drillType}, ${targetShotType ?? null}, ${targetZone ?? null}, ${targetShotCount})
      RETURNING *
    `);
    res.status(201).json(result.rows[0]);
  } catch (err) {
    res.status(500).json({ error: "Failed to create drill" });
  }
});

// DELETE /drills/:id (admin)
router.delete("/drills/:id", requireAdmin, async (req: any, res: any) => {
  try {
    const id = parseInt(req.params.id);
    await db.execute(sql`UPDATE drills SET is_active = false WHERE id = ${id}`);
    res.json({ ok: true });
  } catch (err) {
    res.status(500).json({ error: "Failed to delete drill" });
  }
});

// POST /drills/:id/results — submit drill attempt
router.post("/drills/:id/results", requireAuth, async (req: any, res: any) => {
  try {
    const { userId } = getAuth(req);
    const drillId = parseInt(req.params.id);
    const { leagueId, shotsAttempted, shotsSuccessful, recordingId } = req.body;

    if (shotsAttempted === undefined) return res.status(400).json({ error: "shotsAttempted required" });

    const successPct = shotsAttempted > 0 ? (shotsSuccessful / shotsAttempted) * 100 : 0;

    // Check if this is a personal best
    const prevBest = await db.execute(sql`
      SELECT MAX(success_percentage) as best
      FROM drill_results
      WHERE drill_id = ${drillId} AND user_id = ${userId}
    `);
    const prevBestVal = (prevBest.rows[0] as any)?.best ?? 0;
    const isPersonalBest = successPct > (prevBestVal || 0);

    if (isPersonalBest) {
      await db.execute(sql`
        UPDATE drill_results SET personal_best = false
        WHERE drill_id = ${drillId} AND user_id = ${userId}
      `);
    }

    const result = await db.execute(sql`
      INSERT INTO drill_results (drill_id, user_id, league_id, recording_id,
        shots_attempted, shots_successful, success_percentage, personal_best)
      VALUES (${drillId}, ${userId}, ${leagueId ?? null}, ${recordingId ?? null},
        ${shotsAttempted}, ${shotsSuccessful ?? 0}, ${successPct}, ${isPersonalBest})
      RETURNING *
    `);

    res.status(201).json({ ...result.rows[0], isPersonalBest });
  } catch (err) {
    logger.error({ err }, "Failed to submit drill result");
    res.status(500).json({ error: "Failed to submit result" });
  }
});

// GET /drills/:id/leaderboard
router.get("/drills/:id/leaderboard", requireAuth, async (req: any, res: any) => {
  try {
    const drillId = parseInt(req.params.id);
    const { period = "all" } = req.query;

    let dateFilter = "";
    if (period === "week") dateFilter = `AND dr.attempted_at >= NOW() - INTERVAL '7 days'`;
    else if (period === "month") dateFilter = `AND dr.attempted_at >= NOW() - INTERVAL '30 days'`;

    const result = await db.execute(sql.raw(`
      SELECT dr.user_id,
             MAX(dr.success_percentage) as best_score,
             COUNT(*) as attempts,
             MAX(dr.attempted_at) as last_attempt
      FROM drill_results dr
      WHERE dr.drill_id = ${drillId} ${dateFilter}
      GROUP BY dr.user_id
      ORDER BY best_score DESC
      LIMIT 50
    `));

    res.json(result.rows);
  } catch (err) {
    res.status(500).json({ error: "Failed to fetch leaderboard" });
  }
});

// GET /drills/:id/my-results — current user's results for a drill
router.get("/drills/:id/my-results", requireAuth, async (req: any, res: any) => {
  try {
    const { userId } = getAuth(req);
    const drillId = parseInt(req.params.id);

    const result = await db.execute(sql`
      SELECT * FROM drill_results
      WHERE drill_id = ${drillId} AND user_id = ${userId}
      ORDER BY attempted_at DESC
      LIMIT 20
    `);

    res.json(result.rows);
  } catch (err) {
    res.status(500).json({ error: "Failed to fetch results" });
  }
});

export default router;
