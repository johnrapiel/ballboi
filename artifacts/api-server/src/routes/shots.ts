import { Router } from "express";
import { getAuth } from "@clerk/express";
import { db } from "@workspace/db";
import { sql } from "drizzle-orm";
import { ObjectStorageService } from "../lib/objectStorage";
import { logger } from "../lib/logger";

const router = Router();
const storage = new ObjectStorageService();

const ML_SERVICE_URL = process.env.ML_SERVICE_URL ?? "http://localhost:8000";
const ML_SECRET = process.env.ML_SECRET;
const API_BASE_URL = process.env.API_BASE_URL ?? `http://localhost:${process.env.PORT ?? 8080}`;

function requireAuth(req: any, res: any, next: any) {
  const { userId } = getAuth(req);
  if (!userId) return res.status(401).json({ error: "Unauthorized" });
  next();
}

// POST /shots/upload-url — get a presigned URL to upload a video
router.post("/shots/upload-url", requireAuth, async (req: any, res: any) => {
  try {
    const { userId } = getAuth(req);
    const { fileName, fileSize, contentType, leagueId, quality = "720p", matchId } = req.body;

    if (!fileName || !contentType) {
      return res.status(400).json({ error: "fileName and contentType required" });
    }

    const uploadURL = await storage.getObjectEntityUploadURL();

    // Pre-create the recording row
    const result = await db.execute(sql`
      INSERT INTO shot_recordings (user_id, league_id, match_id, quality, file_size_bytes, processing_status)
      VALUES (${userId}, ${leagueId ?? null}, ${matchId ?? null}, ${quality}, ${fileSize ?? null}, 'pending')
      RETURNING id
    `);
    const recordingId = (result.rows[0] as any).id;

    res.json({ uploadURL, recordingId });
  } catch (err) {
    logger.error({ err }, "Failed to create upload URL");
    res.status(500).json({ error: "Failed to create upload URL" });
  }
});

// POST /shots/:id/confirm — confirm upload complete, trigger ML analysis
router.post("/shots/:id/confirm", requireAuth, async (req: any, res: any) => {
  try {
    const { userId } = getAuth(req);
    const id = parseInt(req.params.id);
    const { objectPath } = req.body;

    if (!objectPath) return res.status(400).json({ error: "objectPath required" });

    // Mark as processing
    await db.execute(sql`
      UPDATE shot_recordings
      SET video_object_path = ${objectPath},
          processing_status = 'processing',
          processing_started_at = NOW()
      WHERE id = ${id} AND user_id = ${userId}
    `);

    // Build a serving URL for the video that the ML service can download
    const videoUrl = `${API_BASE_URL}/api/storage${objectPath}`;
    const callbackUrl = `${API_BASE_URL}/api/shots/${id}/ml-callback`;

    // Call ML service (fire and forget — results come via callback)
    try {
      const mlRes = await fetch(`${ML_SERVICE_URL}/analyze`, {
        method: "POST",
        headers: { "Content-Type": "application/json", ...(ML_SECRET ? { "X-ML-Secret": ML_SECRET } : {}) },
        body: JSON.stringify({ video_url: videoUrl, recording_id: id, callback_url: callbackUrl }),
        signal: AbortSignal.timeout(10000),
      });
      if (!mlRes.ok) throw new Error(`ML service returned ${mlRes.status}`);
    } catch (mlErr) {
      const isTemporarilyUnavailable = mlErr instanceof TypeError || (mlErr instanceof Error && (
        mlErr.name === "AbortError" ||
        mlErr.name === "TimeoutError" ||
        mlErr.message.includes("fetch failed") ||
        mlErr.message.includes("ECONNREFUSED") ||
        mlErr.message.includes("ENOTFOUND") ||
        mlErr.message.includes("ETIMEDOUT") ||
        /ML service returned (502|503|504)/.test(mlErr.message)
      ));
      const userMessage = isTemporarilyUnavailable
        ? "Analysis service is temporarily unavailable — please try again in a moment."
        : "Analysis service could not process this recording. Please try again.";
      logger.warn({ mlErr }, "ML service unavailable — marking as failed");
      await db.execute(sql`
        UPDATE shot_recordings
        SET processing_status = 'failed', processing_error = ${userMessage}
        WHERE id = ${id}
      `);
    }

    res.json({ status: "processing", recordingId: id });
  } catch (err) {
    logger.error({ err }, "Failed to confirm upload");
    res.status(500).json({ error: "Failed to confirm upload" });
  }
});

// POST /shots/:id/ml-callback — receives ML analysis results
router.post("/shots/:id/ml-callback", async (req: any, res: any) => {
  try {
    const secret = req.headers["x-ml-secret"];
    if (!ML_SECRET || typeof secret !== "string" || secret !== ML_SECRET) return res.status(403).json({ error: "Forbidden" });

    const id = parseInt(req.params.id);
    const { status, result, error } = req.body;

    if (status === "completed" && result) {
      const r = result;

      // Save analysis
      await db.execute(sql`
        INSERT INTO shot_analyses (
          recording_id, user_id, league_id, shot_type, shot_type_confidence,
          outcome, outcome_confidence, court_zone_name, court_zone_x, court_zone_y,
          contact_x, contact_y, contact_frame, speed_mph, spin_type, depth,
          angle_degrees, player_stance, total_frames_analyzed, raw_ml_data
        )
        SELECT
          ${id}, r.user_id, r.league_id,
          ${r.shotType}, ${r.shotTypeConfidence},
          ${r.outcome}, ${r.outcomeConfidence},
          ${r.courtZone?.name ?? null}, ${r.courtZone?.x ?? null}, ${r.courtZone?.y ?? null},
          ${r.contactPoint?.x ?? null}, ${r.contactPoint?.y ?? null}, ${r.contactPoint?.frameNumber ?? null},
          ${r.ballTrajectory?.estimatedSpeedMph ?? null}, ${r.ballTrajectory?.spin ?? null},
          ${r.ballTrajectory?.depth ?? null}, ${r.ballTrajectory?.angle ?? null},
          ${r.playerPose?.stance ?? null}, ${r.totalFrames ?? null},
          ${JSON.stringify(r.rawMlData ?? {})}::jsonb
        FROM shot_recordings r WHERE r.id = ${id}
      `);

      await db.execute(sql`
        UPDATE shot_recordings
        SET processing_status = 'completed',
            completed_at = NOW(),
            duration_seconds = ${r.durationSeconds ?? null},
            processing_time_ms = ${r.processingTimeMs ?? null}
        WHERE id = ${id}
      `);
    } else {
      await db.execute(sql`
        UPDATE shot_recordings
        SET processing_status = 'failed',
            processing_error = ${error ?? 'Unknown error'}
        WHERE id = ${id}
      `);
    }

    res.json({ ok: true });
  } catch (err) {
    logger.error({ err }, "ML callback error");
    res.status(500).json({ error: "Callback error" });
  }
});

// GET /shots — get user's shot recordings
router.get("/shots", requireAuth, async (req: any, res: any) => {
  try {
    const { userId } = getAuth(req);
    const { leagueId, shotType, outcome, limit = 50, offset = 0 } = req.query;

    let query = `
      SELECT r.*, a.shot_type, a.outcome, a.court_zone_name, a.speed_mph,
             a.spin_type, a.depth, a.shot_type_confidence, a.outcome_confidence,
             a.court_zone_x, a.court_zone_y, a.contact_x, a.contact_y, a.player_stance
      FROM shot_recordings r
      LEFT JOIN shot_analyses a ON a.recording_id = r.id
      WHERE r.user_id = '${userId}'
    `;
    const params: any[] = [];

    if (leagueId) query += ` AND r.league_id = ${parseInt(leagueId as string)}`;
    if (shotType && shotType !== "all") query += ` AND a.shot_type = '${shotType}'`;
    if (outcome && outcome !== "all") query += ` AND a.outcome = '${outcome}'`;

    query += ` ORDER BY r.recorded_at DESC LIMIT ${parseInt(limit as string)} OFFSET ${parseInt(offset as string)}`;

    const result = await db.execute(sql.raw(query));
    res.json(result.rows);
  } catch (err) {
    logger.error({ err }, "Failed to fetch shots");
    res.status(500).json({ error: "Failed to fetch shots" });
  }
});

// GET /shots/:id — shot detail
router.get("/shots/:id", requireAuth, async (req: any, res: any) => {
  try {
    const { userId } = getAuth(req);
    const id = parseInt(req.params.id);

    const result = await db.execute(sql`
      SELECT r.*,
             a.shot_type, a.shot_type_confidence, a.outcome, a.outcome_confidence,
             a.court_zone_name, a.court_zone_x, a.court_zone_y,
             a.contact_x, a.contact_y, a.contact_frame,
             a.speed_mph, a.spin_type, a.depth, a.angle_degrees,
             a.player_stance, a.total_frames_analyzed, a.raw_ml_data
      FROM shot_recordings r
      LEFT JOIN shot_analyses a ON a.recording_id = r.id
      WHERE r.id = ${id} AND r.user_id = ${userId}
    `);

    if (!result.rows.length) return res.status(404).json({ error: "Not found" });
    res.json(result.rows[0]);
  } catch (err) {
    res.status(500).json({ error: "Failed to fetch shot" });
  }
});

// GET /shots/:id/status — polling endpoint for processing status
router.get("/shots/:id/status", requireAuth, async (req: any, res: any) => {
  try {
    const { userId } = getAuth(req);
    const id = parseInt(req.params.id);

    const result = await db.execute(sql`
      SELECT processing_status, processing_error, completed_at
      FROM shot_recordings
      WHERE id = ${id} AND user_id = ${userId}
    `);

    if (!result.rows.length) return res.status(404).json({ error: "Not found" });
    res.json(result.rows[0]);
  } catch (err) {
    res.status(500).json({ error: "Failed to fetch status" });
  }
});

// DELETE /shots/:id
router.delete("/shots/:id", requireAuth, async (req: any, res: any) => {
  try {
    const { userId } = getAuth(req);
    const id = parseInt(req.params.id);

    await db.execute(sql`
      DELETE FROM shot_recordings WHERE id = ${id} AND user_id = ${userId}
    `);

    res.json({ ok: true });
  } catch (err) {
    res.status(500).json({ error: "Failed to delete shot" });
  }
});

// GET /shots/stats/me — aggregated personal stats
router.get("/shots/stats/me", requireAuth, async (req: any, res: any) => {
  try {
    const { userId } = getAuth(req);
    const { leagueId, period = "lifetime" } = req.query;

    let dateFilter = "";
    if (period === "last7days") dateFilter = `AND r.recorded_at >= NOW() - INTERVAL '7 days'`;
    else if (period === "last30days") dateFilter = `AND r.recorded_at >= NOW() - INTERVAL '30 days'`;

    const leagueFilter = leagueId ? `AND r.league_id = ${parseInt(leagueId as string)}` : "";

    const statsQuery = `
      SELECT
        a.shot_type,
        COUNT(*) as total,
        COUNT(*) FILTER (WHERE a.outcome = 'winner') as winners,
        COUNT(*) FILTER (WHERE a.outcome = 'error') as errors,
        COUNT(*) FILTER (WHERE a.outcome = 'unforced_error') as unforced_errors,
        AVG(a.speed_mph) as avg_speed,
        AVG(a.court_zone_x) as avg_x,
        AVG(a.court_zone_y) as avg_y
      FROM shot_recordings r
      JOIN shot_analyses a ON a.recording_id = r.id
      WHERE r.user_id = '${userId}' ${dateFilter} ${leagueFilter}
      GROUP BY a.shot_type
    `;

    const heatmapQuery = `
      SELECT a.court_zone_x as x, a.court_zone_y as y,
             a.shot_type, a.outcome
      FROM shot_recordings r
      JOIN shot_analyses a ON a.recording_id = r.id
      WHERE r.user_id = '${userId}' ${dateFilter} ${leagueFilter}
        AND a.court_zone_x IS NOT NULL
      LIMIT 500
    `;

    const [statsResult, heatmapResult] = await Promise.all([
      db.execute(sql.raw(statsQuery)),
      db.execute(sql.raw(heatmapQuery)),
    ]);

    res.json({
      byType: statsResult.rows,
      heatmapPoints: heatmapResult.rows,
    });
  } catch (err) {
    logger.error({ err }, "Failed to fetch shot stats");
    res.status(500).json({ error: "Failed to fetch stats" });
  }
});

export default router;
