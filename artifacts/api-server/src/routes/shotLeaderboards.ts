import { Router } from "express";
import { getAuth } from "@clerk/express";
import { db } from "@workspace/db";
import { sql } from "drizzle-orm";

const router = Router();

function requireAuth(req: any, res: any, next: any) {
  const { userId } = getAuth(req);
  if (!userId) return res.status(401).json({ error: "Unauthorized" });
  next();
}

function datePeriodFilter(period: string): string {
  if (period === "week") return `AND r.recorded_at >= NOW() - INTERVAL '7 days'`;
  if (period === "month") return `AND r.recorded_at >= NOW() - INTERVAL '30 days'`;
  return "";
}

// GET /shot-leaderboards/:leagueId/serve-accuracy
router.get("/shot-leaderboards/:leagueId/serve-accuracy", requireAuth, async (req: any, res: any) => {
  try {
    const leagueId = parseInt(req.params.leagueId);
    const { period = "all" } = req.query;
    const df = datePeriodFilter(period as string);

    const result = await db.execute(sql.raw(`
      SELECT
        r.user_id,
        COUNT(*) FILTER (WHERE a.shot_type = 'serve') as total_serves,
        COUNT(*) FILTER (WHERE a.shot_type = 'serve' AND a.court_zone_name IN ('service_box_deuce','service_box_ad')) as serves_in,
        COUNT(*) FILTER (WHERE a.shot_type = 'serve' AND a.outcome = 'winner') as aces,
        ROUND(
          100.0 * COUNT(*) FILTER (WHERE a.shot_type = 'serve' AND a.court_zone_name IN ('service_box_deuce','service_box_ad'))
          / NULLIF(COUNT(*) FILTER (WHERE a.shot_type = 'serve'), 0), 1
        ) as serve_pct
      FROM shot_recordings r
      JOIN shot_analyses a ON a.recording_id = r.id
      WHERE r.league_id = ${leagueId} ${df}
        AND a.shot_type = 'serve'
      GROUP BY r.user_id
      HAVING COUNT(*) FILTER (WHERE a.shot_type = 'serve') >= 5
      ORDER BY serve_pct DESC NULLS LAST
      LIMIT 50
    `));

    res.json(result.rows);
  } catch (err) {
    res.status(500).json({ error: "Failed to fetch serve accuracy leaderboard" });
  }
});

// GET /shot-leaderboards/:leagueId/consistency
router.get("/shot-leaderboards/:leagueId/consistency", requireAuth, async (req: any, res: any) => {
  try {
    const leagueId = parseInt(req.params.leagueId);
    const { period = "all" } = req.query;
    const df = datePeriodFilter(period as string);

    const result = await db.execute(sql.raw(`
      SELECT
        r.user_id,
        COUNT(*) FILTER (WHERE a.shot_type IN ('forehand','backhand')) as total_groundstrokes,
        COUNT(*) FILTER (WHERE a.shot_type IN ('forehand','backhand') AND a.outcome = 'winner') as winners,
        COUNT(*) FILTER (WHERE a.shot_type IN ('forehand','backhand') AND a.outcome IN ('error','unforced_error')) as errors,
        ROUND(
          100.0 * COUNT(*) FILTER (WHERE a.shot_type IN ('forehand','backhand') AND a.outcome = 'winner')
          / NULLIF(COUNT(*) FILTER (WHERE a.shot_type IN ('forehand','backhand')), 0), 1
        ) as groundstroke_win_pct
      FROM shot_recordings r
      JOIN shot_analyses a ON a.recording_id = r.id
      WHERE r.league_id = ${leagueId} ${df}
        AND a.shot_type IN ('forehand', 'backhand')
      GROUP BY r.user_id
      HAVING COUNT(*) FILTER (WHERE a.shot_type IN ('forehand','backhand')) >= 5
      ORDER BY groundstroke_win_pct DESC NULLS LAST
      LIMIT 50
    `));

    res.json(result.rows);
  } catch (err) {
    res.status(500).json({ error: "Failed to fetch consistency leaderboard" });
  }
});

// GET /shot-leaderboards/:leagueId/aces
router.get("/shot-leaderboards/:leagueId/aces", requireAuth, async (req: any, res: any) => {
  try {
    const leagueId = parseInt(req.params.leagueId);
    const { period = "all" } = req.query;
    const df = datePeriodFilter(period as string);

    const result = await db.execute(sql.raw(`
      SELECT
        r.user_id,
        COUNT(*) FILTER (WHERE a.shot_type = 'serve' AND a.outcome = 'winner') as aces,
        COUNT(*) FILTER (WHERE a.shot_type = 'serve') as total_serves
      FROM shot_recordings r
      JOIN shot_analyses a ON a.recording_id = r.id
      WHERE r.league_id = ${leagueId} ${df}
      GROUP BY r.user_id
      ORDER BY aces DESC
      LIMIT 50
    `));

    res.json(result.rows);
  } catch (err) {
    res.status(500).json({ error: "Failed to fetch aces leaderboard" });
  }
});

// GET /shot-leaderboards/:leagueId/winners
router.get("/shot-leaderboards/:leagueId/winners", requireAuth, async (req: any, res: any) => {
  try {
    const leagueId = parseInt(req.params.leagueId);
    const { period = "all", shotType } = req.query;
    const df = datePeriodFilter(period as string);
    const stFilter = shotType && shotType !== "all" ? `AND a.shot_type = '${shotType}'` : "";

    const result = await db.execute(sql.raw(`
      SELECT
        r.user_id,
        COUNT(*) FILTER (WHERE a.outcome = 'winner') as winners,
        COUNT(*) as total_shots,
        ROUND(
          100.0 * COUNT(*) FILTER (WHERE a.outcome = 'winner')
          / NULLIF(COUNT(*), 0), 1
        ) as winner_pct
      FROM shot_recordings r
      JOIN shot_analyses a ON a.recording_id = r.id
      WHERE r.league_id = ${leagueId} ${df} ${stFilter}
      GROUP BY r.user_id
      ORDER BY winners DESC
      LIMIT 50
    `));

    res.json(result.rows);
  } catch (err) {
    res.status(500).json({ error: "Failed to fetch winners leaderboard" });
  }
});

// GET /shot-leaderboards/:leagueId/efficiency
router.get("/shot-leaderboards/:leagueId/efficiency", requireAuth, async (req: any, res: any) => {
  try {
    const leagueId = parseInt(req.params.leagueId);
    const { period = "all" } = req.query;
    const df = datePeriodFilter(period as string);

    const result = await db.execute(sql.raw(`
      SELECT
        r.user_id,
        COUNT(*) FILTER (WHERE a.outcome = 'winner') as winners,
        COUNT(*) FILTER (WHERE a.outcome IN ('error','unforced_error')) as errors,
        COUNT(*) as total_shots,
        ROUND(
          1.0 * COUNT(*) FILTER (WHERE a.outcome = 'winner')
          / NULLIF(COUNT(*) FILTER (WHERE a.outcome IN ('error','unforced_error')), 0), 2
        ) as winner_error_ratio
      FROM shot_recordings r
      JOIN shot_analyses a ON a.recording_id = r.id
      WHERE r.league_id = ${leagueId} ${df}
      GROUP BY r.user_id
      HAVING COUNT(*) >= 10
      ORDER BY winner_error_ratio DESC NULLS LAST
      LIMIT 50
    `));

    res.json(result.rows);
  } catch (err) {
    res.status(500).json({ error: "Failed to fetch efficiency leaderboard" });
  }
});

export default router;
