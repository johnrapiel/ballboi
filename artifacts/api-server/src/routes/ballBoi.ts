import { NextFunction, Request, Response, Router } from "express";
import { getAuth } from "@clerk/express";
import { randomUUID } from "crypto";
import { db } from "@workspace/db";
import {
  ballBoiSessionsTable,
  leaguesTable,
  matchesTable,
  matchShotsTable,
  matchStatisticsTable,
  playersTable,
} from "@workspace/db";
import { desc, eq, inArray, sql } from "drizzle-orm";
import { ObjectStorageService } from "../lib/objectStorage";
import { logger } from "../lib/logger";
import {
  asRecord,
  stringOrNull,
  normalizeNumber,
  courtCalibrationFromMetadata,
  buildShotFromResult,
  computeStats,
  buildNarrative,
  type UnknownRecord,
} from "../lib/ballBoiUtils";
import { computeNextRetryAt } from "../services/ballBoiRetry";
import { isMlServiceUnreachable } from "../lib/mlServiceErrors";

const router = Router();
const storage = new ObjectStorageService();

const ML_SERVICE_URL = process.env.ML_SERVICE_URL ?? "http://localhost:8000";
const ML_SECRET = process.env.ML_SECRET;
const API_BASE_URL = process.env.API_BASE_URL ?? `http://localhost:${process.env.PORT ?? 8080}`;

const ML_UNAVAILABLE_MESSAGE =
  "Analysis service is temporarily unavailable — your video has been saved and results will appear once the service is back online.";

function requireAuth(req: Request, res: Response, next: NextFunction) {
  const { userId } = getAuth(req);
  if (!userId) return res.status(401).json({ error: "Unauthorized" });
  next();
}

async function canAccessMatch(matchId: number, userId: string) {
  const [match] = await db.select().from(matchesTable).where(eq(matchesTable.id, matchId));
  if (!match) return { allowed: false, match: null };
  const callerPlayers = await db.select().from(playersTable).where(eq(playersTable.clerkUserId, userId));
  const callerPlayer = callerPlayers[0] ?? null;
  const participantIds = [match.player1Id, match.player2Id, match.player3Id, match.player4Id].filter((id): id is number => id != null);
  const isParticipant = callerPlayer != null && participantIds.includes(callerPlayer.id);
  let isLeagueCreator = false;
  if (!isParticipant && match.leagueId != null) {
    const [league] = await db.select().from(leaguesTable).where(eq(leaguesTable.id, match.leagueId));
    isLeagueCreator = league?.createdByClerkUserId === userId;
  }
  return { allowed: isParticipant || isLeagueCreator, match };
}

async function canAccessSession(sessionId: number, userId: string) {
  const [session] = await db.select().from(ballBoiSessionsTable).where(eq(ballBoiSessionsTable.id, sessionId));
  if (!session) return { allowed: false, session: null, match: null };
  const access = await canAccessMatch(session.matchId, userId);
  return { allowed: access.allowed || session.recordedByClerkUserId === userId, session, match: access.match };
}

function sessionCallbackToken(session: typeof ballBoiSessionsTable.$inferSelect) {
  const metadata = session.metadata as Record<string, unknown> | null;
  return typeof metadata?.mlCallbackToken === "string" ? metadata.mlCallbackToken : null;
}

async function saveBatchResults(sessionId: number, matchId: number, result: unknown) {
  const payload = asRecord(result);
  const existing = await db.select().from(matchShotsTable).where(eq(matchShotsTable.sessionId, sessionId));
  if (existing.length > 0) {
    await db.delete(matchShotsTable).where(eq(matchShotsTable.sessionId, sessionId));
    await db.delete(matchStatisticsTable).where(eq(matchStatisticsTable.sessionId, sessionId));
  }

  const duration = normalizeNumber(payload.durationSeconds, 0);
  const resultShots = Array.isArray(payload.shots) && payload.shots.length > 0 ? payload.shots : payload.shotType ? [payload] : [];
  if (resultShots.length === 0) {
    await db.update(ballBoiSessionsTable).set({
      status: "failed",
      processingStatus: "failed",
      processingError: "ML analysis completed without detected shots",
    }).where(eq(ballBoiSessionsTable.id, sessionId));
    return;
  }
  const [match] = await db.select().from(matchesTable).where(eq(matchesTable.id, matchId));
  const participantIds = match ? [match.player1Id, match.player2Id, match.player3Id, match.player4Id].filter((id): id is number => id != null) : [];
  const players = participantIds.length > 0 ? await db.select().from(playersTable).where(inArray(playersTable.id, participantIds)) : [];
  const shots = resultShots.map((shotResult: unknown, i: number) => {
    const shotPayload = asRecord(shotResult);
    const withPlayer = {
      ...shotPayload,
      playerId: shotPayload.playerId ?? participantIds[i % Math.max(participantIds.length, 1)] ?? null,
    };
    return buildShotFromResult(
      withPlayer,
      normalizeNumber(shotPayload.sequenceNumber, i + 1),
      matchId,
      sessionId,
      normalizeNumber(shotPayload.timestampSeconds, duration ? Math.min(duration, i * Math.max(4, duration / resultShots.length)) : i * 8),
      normalizeNumber(shotPayload.rallyNumber, Math.floor(i / 5) + 1),
    );
  });

  const inserted = await db.insert(matchShotsTable).values(shots).returning();
  const stats = computeStats(inserted, players);
  const allPlayers = await db.select().from(playersTable);
  const pMap: Record<number, string> = {};
  for (const p of allPlayers) pMap[p.id] = p.name;
  const matchTitle = match ? `${pMap[match.player1Id] ?? "Player 1"} vs ${pMap[match.player2Id] ?? "Player 2"}` : "The match";
  const aiNarrative = buildNarrative(matchTitle, stats, inserted);

  await db.insert(matchStatisticsTable).values({ sessionId, matchId, ...stats });
  await db.update(ballBoiSessionsTable).set({
    status: "completed",
    processingStatus: "completed",
    processingError: null,
    aiNarrative,
    durationSeconds: Math.round(duration || normalizeNumber(asRecord(payload.metadata).durationSeconds, 0)),
  }).where(eq(ballBoiSessionsTable.id, sessionId));
}

router.get("/ball-boi/ml-health", async (_req: Request, res: Response) => {
  try {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), 3000);
    try {
      const mlRes = await fetch(`${ML_SERVICE_URL}/health`, {
        method: "HEAD",
        signal: controller.signal,
        headers: ML_SECRET ? { "X-ML-Secret": ML_SECRET } : {},
      });
      clearTimeout(timer);
      res.json({ reachable: mlRes.ok || mlRes.status < 500 });
    } catch {
      clearTimeout(timer);
      res.json({ reachable: false });
    }
  } catch (err) {
    logger.error({ err }, "ML health check failed");
    res.json({ reachable: false });
  }
});

router.post("/ball-boi/matches/:matchId/sessions/start", requireAuth, async (req: Request, res: Response) => {
  try {
    const { userId } = getAuth(req);
    const matchId = parseInt(req.params.matchId);
    if (isNaN(matchId)) return res.status(400).json({ error: "Invalid match id" });
    const access = await canAccessMatch(matchId, userId);
    if (!access.match) return res.status(404).json({ error: "Match not found" });
    if (!access.allowed) return res.status(403).json({ error: "Forbidden" });
    const [session] = await db.insert(ballBoiSessionsTable).values({
      matchId,
      recordedByClerkUserId: userId,
      status: "recording",
      processingStatus: "pending",
      metadata: req.body?.metadata ?? {},
    }).returning();
    res.status(201).json(session);
  } catch (err) {
    logger.error({ err }, "Failed to start Ball Boi session");
    res.status(500).json({ error: "Failed to start Ball Boi session" });
  }
});

router.post("/ball-boi/sessions/:sessionId/upload-url", requireAuth, async (req: Request, res: Response) => {
  try {
    const { userId } = getAuth(req);
    const sessionId = parseInt(req.params.sessionId);
    if (isNaN(sessionId)) return res.status(400).json({ error: "Invalid session id" });
    const [session] = await db.select().from(ballBoiSessionsTable).where(eq(ballBoiSessionsTable.id, sessionId));
    if (!session) return res.status(404).json({ error: "Session not found" });
    if (session.recordedByClerkUserId !== userId) return res.status(403).json({ error: "Forbidden" });
    const uploadURL = await storage.getObjectEntityUploadURL();
    const objectPath = storage.normalizeObjectEntityPath(uploadURL);
    res.json({ uploadURL, objectPath });
  } catch (err) {
    logger.error({ err }, "Failed to create Ball Boi upload URL");
    res.status(500).json({ error: "Failed to create upload URL" });
  }
});

router.post("/ball-boi/sessions/:sessionId/cancel", requireAuth, async (req: Request, res: Response) => {
  try {
    const { userId } = getAuth(req);
    const sessionId = parseInt(req.params.sessionId);
    if (isNaN(sessionId)) return res.status(400).json({ error: "Invalid session id" });
    const [session] = await db.select().from(ballBoiSessionsTable).where(eq(ballBoiSessionsTable.id, sessionId));
    if (!session) return res.status(404).json({ error: "Session not found" });
    if (session.recordedByClerkUserId !== userId) return res.status(403).json({ error: "Forbidden" });
    if (session.status !== "recording") return res.status(409).json({ error: "Only active recording sessions can be cancelled" });
    const [updated] = await db.update(ballBoiSessionsTable).set({
      status: "failed",
      processingStatus: "failed",
      processingError: stringOrNull(req.body?.reason) ?? "Recording was cancelled before video capture started",
      recordingStoppedAt: new Date(),
    }).where(eq(ballBoiSessionsTable.id, sessionId)).returning();
    res.json(updated);
  } catch (err) {
    logger.error({ err }, "Failed to cancel Ball Boi session");
    res.status(500).json({ error: "Failed to cancel Ball Boi session" });
  }
});

router.post("/ball-boi/sessions/:sessionId/live-shot", requireAuth, async (req: Request, res: Response) => {
  try {
    const { userId } = getAuth(req);
    const sessionId = parseInt(req.params.sessionId);
    const [session] = await db.select().from(ballBoiSessionsTable).where(eq(ballBoiSessionsTable.id, sessionId));
    if (!session) return res.status(404).json({ error: "Session not found" });
    if (session.recordedByClerkUserId !== userId) return res.status(403).json({ error: "Forbidden" });
    const timestampSeconds = normalizeNumber(req.body?.timestampSeconds, 0);
    let liveResult: unknown = null;
    try {
      const mlRes = await fetch(`${ML_SERVICE_URL}/analyze-match-live`, {
        method: "POST",
        headers: { "Content-Type": "application/json", ...(ML_SECRET ? { "X-ML-Secret": ML_SECRET } : {}) },
        body: JSON.stringify({
          session_id: sessionId,
          timestamp_seconds: timestampSeconds,
          frame_image: req.body?.frameImage ?? null,
          court_calibration: courtCalibrationFromMetadata(session.metadata),
        }),
        signal: AbortSignal.timeout(2500),
      });
      if (mlRes.ok) liveResult = await mlRes.json();
    } catch (mlErr) {
      logger.warn({ mlErr }, "Live Ball Boi ML analysis unavailable");
    }
    const livePayload = asRecord(liveResult);
    const liveShotResult = livePayload.result;
    if (!liveShotResult) return res.status(204).send();
    const currentCount = await db.select({ count: sql<number>`count(*)` }).from(matchShotsTable).where(eq(matchShotsTable.sessionId, sessionId));
    const sequenceNumber = Number(currentCount[0]?.count ?? 0) + 1;
    const [match] = await db.select().from(matchesTable).where(eq(matchesTable.id, session.matchId));
    const participantIds = match ? [match.player1Id, match.player2Id, match.player3Id, match.player4Id].filter((id): id is number => id != null) : [];
    const shot = buildShotFromResult(
      { ...asRecord(liveShotResult), playerId: asRecord(liveShotResult).playerId ?? participantIds[(sequenceNumber - 1) % Math.max(participantIds.length, 1)] ?? null },
      sequenceNumber,
      session.matchId,
      sessionId,
      timestampSeconds,
      Math.floor(sequenceNumber / 5) + 1,
    );
    const [inserted] = await db.insert(matchShotsTable).values(shot).returning();
    res.status(201).json(inserted);
  } catch (err) {
    logger.error({ err }, "Failed to save live Ball Boi shot");
    res.status(500).json({ error: "Failed to save live shot" });
  }
});

router.post("/ball-boi/sessions/:sessionId/complete", requireAuth, async (req: Request, res: Response) => {
  try {
    const { userId } = getAuth(req);
    const sessionId = parseInt(req.params.sessionId);
    const [session] = await db.select().from(ballBoiSessionsTable).where(eq(ballBoiSessionsTable.id, sessionId));
    if (!session) return res.status(404).json({ error: "Session not found" });
    if (session.recordedByClerkUserId !== userId) return res.status(403).json({ error: "Forbidden" });
    const { objectPath, contentType, sizeBytes, durationSeconds } = req.body ?? {};
    if (!objectPath) return res.status(400).json({ error: "objectPath required" });
    const [updated] = await db.update(ballBoiSessionsTable).set({
      status: "processing",
      processingStatus: "processing",
      recordingStoppedAt: new Date(),
      videoObjectPath: objectPath,
      videoContentType: contentType ?? null,
      videoSizeBytes: sizeBytes ?? null,
      durationSeconds: Math.round(normalizeNumber(durationSeconds, 0)),
    }).where(eq(ballBoiSessionsTable.id, sessionId)).returning();

    const metadata = (session.metadata as Record<string, unknown> | null) ?? {};
    const mlCallbackToken = typeof metadata.mlCallbackToken === "string" ? metadata.mlCallbackToken : randomUUID();
    await db.update(ballBoiSessionsTable).set({ metadata: { ...metadata, mlCallbackToken, chunks: req.body?.chunks ?? [] } }).where(eq(ballBoiSessionsTable.id, sessionId));
    const videoUrl = `${API_BASE_URL}/api/storage${objectPath}`;
    const callbackUrl = `${API_BASE_URL}/api/ball-boi/sessions/${sessionId}/ml-callback?token=${encodeURIComponent(mlCallbackToken)}`;
    try {
      const mlRes = await fetch(`${ML_SERVICE_URL}/analyze-match-batch`, {
        method: "POST",
        headers: { "Content-Type": "application/json", ...(ML_SECRET ? { "X-ML-Secret": ML_SECRET } : {}) },
        body: JSON.stringify({
          video_url: videoUrl,
          session_id: sessionId,
          match_id: session.matchId,
          callback_url: callbackUrl,
          court_calibration: courtCalibrationFromMetadata(session.metadata),
        }),
        signal: AbortSignal.timeout(5000),
      });
      if (!mlRes.ok) throw new Error(`ML service returned ${mlRes.status}`);
    } catch (mlErr) {
      const isUnreachable = isMlServiceUnreachable(mlErr);
      logger.warn({ mlErr, isUnreachable }, "Batch Ball Boi ML service unavailable; finalizing from live detections");
      const liveShots = await db.select().from(matchShotsTable).where(eq(matchShotsTable.sessionId, sessionId));
      if (liveShots.length > 0) {
        const [match] = await db.select().from(matchesTable).where(eq(matchesTable.id, session.matchId));
        const participantIds = match ? [match.player1Id, match.player2Id, match.player3Id, match.player4Id].filter((id): id is number => id != null) : [];
        const players = participantIds.length > 0 ? await db.select().from(playersTable).where(inArray(playersTable.id, participantIds)) : [];
        const stats = computeStats(liveShots, players);
        await db.delete(matchStatisticsTable).where(eq(matchStatisticsTable.sessionId, sessionId));
        await db.insert(matchStatisticsTable).values({ sessionId, matchId: session.matchId, ...stats });
        await db.update(ballBoiSessionsTable).set({
          status: "completed",
          processingStatus: "completed",
          aiNarrative: buildNarrative("The match", stats, liveShots),
        }).where(eq(ballBoiSessionsTable.id, sessionId));
      } else {
        const mergedMetadata = { ...metadata, mlCallbackToken, chunks: req.body?.chunks ?? [] };
        const failedMetadata = isUnreachable
          ? { ...mergedMetadata, retryCount: 0, nextRetryAt: computeNextRetryAt(0).toISOString() }
          : mergedMetadata;
        await db.update(ballBoiSessionsTable).set({
          status: "failed",
          processingStatus: "failed",
          processingError: isUnreachable
            ? ML_UNAVAILABLE_MESSAGE
            : "Analysis service could not process this recording. Please try again.",
          metadata: failedMetadata,
        }).where(eq(ballBoiSessionsTable.id, sessionId));
      }
    }

    res.json(updated);
  } catch (err) {
    logger.error({ err }, "Failed to complete Ball Boi session");
    res.status(500).json({ error: "Failed to complete Ball Boi session" });
  }
});

router.post("/ball-boi/sessions/:sessionId/ml-callback", async (req: Request, res: Response) => {
  try {
    const sessionId = parseInt(req.params.sessionId);
    const [session] = await db.select().from(ballBoiSessionsTable).where(eq(ballBoiSessionsTable.id, sessionId));
    if (!session) return res.status(404).json({ error: "Session not found" });
    const callbackToken = sessionCallbackToken(session);
    const incomingSecret = req.headers["x-ml-secret"];
    const secretMatches = !!ML_SECRET && typeof incomingSecret === "string" && incomingSecret === ML_SECRET;
    const tokenMatches = !!callbackToken && req.query.token === callbackToken;
    if (ML_SECRET ? !secretMatches : !tokenMatches) return res.status(403).json({ error: "Forbidden" });
    const { status, result, error } = req.body ?? {};
    if (status === "completed" && result) {
      await saveBatchResults(sessionId, session.matchId, result);
    } else {
      await db.update(ballBoiSessionsTable).set({
        status: "failed",
        processingStatus: "failed",
        processingError: error ?? "Unknown ML error",
      }).where(eq(ballBoiSessionsTable.id, sessionId));
    }
    res.json({ ok: true });
  } catch (err) {
    logger.error({ err }, "Ball Boi ML callback error");
    res.status(500).json({ error: "Callback error" });
  }
});

router.get("/ball-boi/matches/:matchId/replay", requireAuth, async (req: Request, res: Response) => {
  try {
    const { userId } = getAuth(req);
    const matchId = parseInt(req.params.matchId);
    if (isNaN(matchId)) return res.status(400).json({ error: "Invalid match id" });
    const access = await canAccessMatch(matchId, userId);
    if (!access.match) return res.status(404).json({ error: "Match not found" });
    if (!access.allowed) return res.status(403).json({ error: "Forbidden" });
    const sessions = await db.select().from(ballBoiSessionsTable).where(eq(ballBoiSessionsTable.matchId, matchId)).orderBy(desc(ballBoiSessionsTable.createdAt));
    const session = sessions[0] ?? null;
    if (!session) return res.json({ match: access.match, session: null, shots: [], statistics: null, videoUrl: null });
    const [shots, statsRows] = await Promise.all([
      db.select().from(matchShotsTable).where(eq(matchShotsTable.sessionId, session.id)).orderBy(matchShotsTable.sequenceNumber),
      db.select().from(matchStatisticsTable).where(eq(matchStatisticsTable.sessionId, session.id)),
    ]);
    let videoUrl: string | null = null;
    if (session.videoObjectPath) {
      try {
        videoUrl = await storage.getObjectEntityViewURL(session.videoObjectPath);
      } catch (urlErr) {
        logger.warn({ urlErr }, "Failed to generate signed video URL for replay");
      }
    }
    res.json({ match: access.match, session, shots, statistics: statsRows[0] ?? null, videoUrl });
  } catch (err) {
    logger.error({ err }, "Failed to load Ball Boi replay");
    res.status(500).json({ error: "Failed to load replay" });
  }
});

router.post("/matches/:matchId/ball-boi/sessions/start", requireAuth, async (req: Request, res: Response) => {
  req.url = `/ball-boi/matches/${req.params.matchId}/sessions/start`;
  router.handle(req, res);
});

router.get("/matches/:matchId/ball-boi/replay", requireAuth, async (req: Request, res: Response) => {
  req.url = `/ball-boi/matches/${req.params.matchId}/replay`;
  router.handle(req, res);
});

async function latestSessionForMatch(matchId: number) {
  const sessions = await db.select().from(ballBoiSessionsTable).where(eq(ballBoiSessionsTable.matchId, matchId)).orderBy(desc(ballBoiSessionsTable.createdAt));
  return sessions[0] ?? null;
}

router.post("/matches/:matchId/ball-boi/end", requireAuth, async (req: Request, res: Response) => {
  try {
    const { userId } = getAuth(req);
    const matchId = parseInt(req.params.matchId);
    const access = await canAccessMatch(matchId, userId);
    if (!access.match) return res.status(404).json({ error: "Match not found" });
    if (!access.allowed) return res.status(403).json({ error: "Forbidden" });
    const session = await latestSessionForMatch(matchId);
    if (!session) return res.status(404).json({ error: "Ball Boi session not found" });
    const { objectPath, contentType, sizeBytes, durationSeconds } = req.body ?? {};
    if (!objectPath) return res.status(400).json({ error: "objectPath required" });
    const [updated] = await db.update(ballBoiSessionsTable).set({
      status: "processing",
      processingStatus: "processing",
      recordingStoppedAt: new Date(),
      videoObjectPath: objectPath,
      videoContentType: contentType ?? null,
      videoSizeBytes: sizeBytes ?? null,
      durationSeconds: Math.round(normalizeNumber(durationSeconds, 0)),
    }).where(eq(ballBoiSessionsTable.id, session.id)).returning();
    const metadata = (session.metadata as Record<string, unknown> | null) ?? {};
    const mlCallbackToken = typeof metadata.mlCallbackToken === "string" ? metadata.mlCallbackToken : randomUUID();
    await db.update(ballBoiSessionsTable).set({ metadata: { ...metadata, mlCallbackToken, chunks: req.body?.chunks ?? [] } }).where(eq(ballBoiSessionsTable.id, session.id));
    const videoUrl = `${API_BASE_URL}/api/storage${objectPath}`;
    const callbackUrl = `${API_BASE_URL}/api/matches/${matchId}/ball-boi/shot-callback?token=${encodeURIComponent(mlCallbackToken)}`;
    try {
      const mlRes = await fetch(`${ML_SERVICE_URL}/analyze-match-batch`, {
        method: "POST",
        headers: { "Content-Type": "application/json", ...(ML_SECRET ? { "X-ML-Secret": ML_SECRET } : {}) },
        body: JSON.stringify({
          video_url: videoUrl,
          session_id: session.id,
          match_id: matchId,
          callback_url: callbackUrl,
          court_calibration: courtCalibrationFromMetadata(session.metadata),
        }),
        signal: AbortSignal.timeout(5000),
      });
      if (!mlRes.ok) throw new Error(`ML service returned ${mlRes.status}`);
    } catch (mlErr) {
      const isUnreachable = isMlServiceUnreachable(mlErr);
      logger.warn({ mlErr, isUnreachable }, "Batch Ball Boi ML service unavailable; finalizing match-scoped end from live detections");
      const liveShots = await db.select().from(matchShotsTable).where(eq(matchShotsTable.sessionId, session.id));
      if (liveShots.length > 0) {
        const participantIds = [access.match.player1Id, access.match.player2Id, access.match.player3Id, access.match.player4Id].filter((id): id is number => id != null);
        const players = participantIds.length > 0 ? await db.select().from(playersTable).where(inArray(playersTable.id, participantIds)) : [];
        const stats = computeStats(liveShots, players);
        await db.delete(matchStatisticsTable).where(eq(matchStatisticsTable.sessionId, session.id));
        await db.insert(matchStatisticsTable).values({ sessionId: session.id, matchId, ...stats });
        await db.update(ballBoiSessionsTable).set({
          status: "completed",
          processingStatus: "completed",
          aiNarrative: buildNarrative("The match", stats, liveShots),
        }).where(eq(ballBoiSessionsTable.id, session.id));
      } else {
        const endMetadata = { ...metadata, mlCallbackToken, chunks: req.body?.chunks ?? [] };
        const failedEndMetadata = isUnreachable
          ? { ...endMetadata, retryCount: 0, nextRetryAt: computeNextRetryAt(0).toISOString() }
          : endMetadata;
        await db.update(ballBoiSessionsTable).set({
          status: "failed",
          processingStatus: "failed",
          processingError: isUnreachable
            ? ML_UNAVAILABLE_MESSAGE
            : "Analysis service could not process this recording. Please try again.",
          metadata: failedEndMetadata,
        }).where(eq(ballBoiSessionsTable.id, session.id));
      }
    }
    res.json(updated);
  } catch (err) {
    logger.error({ err }, "Failed to end match Ball Boi session");
    res.status(500).json({ error: "Failed to end Ball Boi session" });
  }
});

router.post("/matches/:matchId/ball-boi/shot-callback", async (req: Request, res: Response) => {
  try {
    const matchId = parseInt(req.params.matchId);
    const body = asRecord(req.body);
    const requestedSessionId = normalizeNumber(body.sessionId, 0);
    const session = requestedSessionId > 0
      ? (await db.select().from(ballBoiSessionsTable).where(eq(ballBoiSessionsTable.id, requestedSessionId)))[0]
      : await latestSessionForMatch(matchId);
    if (!session || session.matchId !== matchId) return res.status(404).json({ error: "Session not found" });
    const callbackToken = sessionCallbackToken(session);
    const incomingSecret = req.headers["x-ml-secret"];
    const secretMatches = !!ML_SECRET && typeof incomingSecret === "string" && incomingSecret === ML_SECRET;
    const tokenMatches = !!callbackToken && req.query.token === callbackToken;
    if (ML_SECRET ? !secretMatches : !tokenMatches) return res.status(403).json({ error: "Forbidden" });
    if (body.status === "completed" && body.result) {
      await saveBatchResults(session.id, session.matchId, body.result);
    } else {
      await db.update(ballBoiSessionsTable).set({
        status: "failed",
        processingStatus: "failed",
        processingError: stringOrNull(body.error) ?? "Unknown ML error",
      }).where(eq(ballBoiSessionsTable.id, session.id));
    }
    res.json({ ok: true });
  } catch (err) {
    logger.error({ err }, "Match Ball Boi shot callback error");
    res.status(500).json({ error: "Callback error" });
  }
});

router.get("/matches/:matchId/ball-boi/status", requireAuth, async (req: Request, res: Response) => {
  try {
    const { userId } = getAuth(req);
    const matchId = parseInt(req.params.matchId);
    const access = await canAccessMatch(matchId, userId);
    if (!access.match) return res.status(404).json({ error: "Match not found" });
    if (!access.allowed) return res.status(403).json({ error: "Forbidden" });
    const session = await latestSessionForMatch(matchId);
    if (!session) return res.json({ sessionId: null, status: "none", processingStatus: "none", processingError: null, shotCount: 0, progress: 0 });
    const shotCount = await db.select({ count: sql<number>`count(*)` }).from(matchShotsTable).where(eq(matchShotsTable.sessionId, session.id));
    res.json({
      sessionId: session.id,
      status: session.status,
      processingStatus: session.processingStatus,
      processingError: session.processingError,
      shotCount: Number(shotCount[0]?.count ?? 0),
      progress: session.processingStatus === "completed" ? 100 : session.processingStatus === "processing" ? 65 : session.processingStatus === "failed" ? 100 : 0,
    });
  } catch (err) {
    logger.error({ err }, "Failed to load match Ball Boi status");
    res.status(500).json({ error: "Failed to load status" });
  }
});

router.get("/matches/:matchId/narrative", requireAuth, async (req: Request, res: Response) => {
  try {
    const { userId } = getAuth(req);
    const matchId = parseInt(req.params.matchId);
    const access = await canAccessMatch(matchId, userId);
    if (!access.match) return res.status(404).json({ error: "Match not found" });
    if (!access.allowed) return res.status(403).json({ error: "Forbidden" });
    const session = await latestSessionForMatch(matchId);
    if (!session) return res.json({ matchId, sessionId: null, narrative: null });
    res.json({ matchId, sessionId: session.id, narrative: session.aiNarrative });
  } catch (err) {
    logger.error({ err }, "Failed to load match Ball Boi narrative");
    res.status(500).json({ error: "Failed to load narrative" });
  }
});

router.get("/matches/:matchId/ball-boi/replay-metadata", requireAuth, async (req: Request, res: Response) => {
  try {
    const { userId } = getAuth(req);
    const matchId = parseInt(req.params.matchId);
    const access = await canAccessMatch(matchId, userId);
    if (!access.match) return res.status(404).json({ error: "Match not found" });
    if (!access.allowed) return res.status(403).json({ error: "Forbidden" });
    const session = await latestSessionForMatch(matchId);
    if (!session) return res.json({ session: null, match: access.match, shotMarkers: [], chapters: [] });
    req.url = `/ball-boi/sessions/${session.id}/replay-metadata`;
    router.handle(req, res);
  } catch (err) {
    logger.error({ err }, "Failed to load match Ball Boi replay metadata");
    res.status(500).json({ error: "Failed to load metadata" });
  }
});

router.get("/matches/:matchId/shots", requireAuth, async (req: Request, res: Response) => {
  try {
    const { userId } = getAuth(req);
    const matchId = parseInt(req.params.matchId);
    const access = await canAccessMatch(matchId, userId);
    if (!access.match) return res.status(404).json({ error: "Match not found" });
    if (!access.allowed) return res.status(403).json({ error: "Forbidden" });
    const session = await latestSessionForMatch(matchId);
    if (!session) return res.json([]);
    const shots = await db.select().from(matchShotsTable).where(eq(matchShotsTable.sessionId, session.id)).orderBy(matchShotsTable.sequenceNumber);
    res.json(shots);
  } catch (err) {
    logger.error({ err }, "Failed to load match Ball Boi shots");
    res.status(500).json({ error: "Failed to load shots" });
  }
});

router.get("/matches/:matchId/statistics", requireAuth, async (req: Request, res: Response) => {
  try {
    const { userId } = getAuth(req);
    const matchId = parseInt(req.params.matchId);
    const access = await canAccessMatch(matchId, userId);
    if (!access.match) return res.status(404).json({ error: "Match not found" });
    if (!access.allowed) return res.status(403).json({ error: "Forbidden" });
    const session = await latestSessionForMatch(matchId);
    if (!session) return res.json(null);
    const [stats] = await db.select().from(matchStatisticsTable).where(eq(matchStatisticsTable.sessionId, session.id));
    res.json(stats ?? null);
  } catch (err) {
    logger.error({ err }, "Failed to load match Ball Boi statistics");
    res.status(500).json({ error: "Failed to load statistics" });
  }
});

router.get("/ball-boi/sessions/:sessionId/status", requireAuth, async (req: Request, res: Response) => {
  try {
    const { userId } = getAuth(req);
    const sessionId = parseInt(req.params.sessionId);
    const access = await canAccessSession(sessionId, userId);
    if (!access.session) return res.status(404).json({ error: "Session not found" });
    if (!access.allowed) return res.status(403).json({ error: "Forbidden" });
    const shotCount = await db.select({ count: sql<number>`count(*)` }).from(matchShotsTable).where(eq(matchShotsTable.sessionId, sessionId));
    const sessionMeta = (access.session.metadata as Record<string, unknown> | null) ?? {};
    const retryCount = typeof sessionMeta.retryCount === "number" ? sessionMeta.retryCount : null;
    const nextRetryAt = typeof sessionMeta.nextRetryAt === "string" ? sessionMeta.nextRetryAt : null;
    res.json({
      sessionId,
      status: access.session.status,
      processingStatus: access.session.processingStatus,
      processingError: access.session.processingError,
      shotCount: Number(shotCount[0]?.count ?? 0),
      progress: access.session.processingStatus === "completed" ? 100 : access.session.processingStatus === "processing" ? 65 : access.session.processingStatus === "failed" ? 100 : 0,
      retryCount,
      nextRetryAt,
    });
  } catch (err) {
    logger.error({ err }, "Failed to load Ball Boi status");
    res.status(500).json({ error: "Failed to load status" });
  }
});

router.get("/ball-boi/sessions/:sessionId/shots", requireAuth, async (req: Request, res: Response) => {
  try {
    const { userId } = getAuth(req);
    const sessionId = parseInt(req.params.sessionId);
    const access = await canAccessSession(sessionId, userId);
    if (!access.session) return res.status(404).json({ error: "Session not found" });
    if (!access.allowed) return res.status(403).json({ error: "Forbidden" });
    const shots = await db.select().from(matchShotsTable).where(eq(matchShotsTable.sessionId, sessionId)).orderBy(matchShotsTable.sequenceNumber);
    res.json(shots);
  } catch (err) {
    logger.error({ err }, "Failed to load Ball Boi shots");
    res.status(500).json({ error: "Failed to load shots" });
  }
});

router.get("/ball-boi/sessions/:sessionId/statistics", requireAuth, async (req: Request, res: Response) => {
  try {
    const { userId } = getAuth(req);
    const sessionId = parseInt(req.params.sessionId);
    const access = await canAccessSession(sessionId, userId);
    if (!access.session) return res.status(404).json({ error: "Session not found" });
    if (!access.allowed) return res.status(403).json({ error: "Forbidden" });
    const [stats] = await db.select().from(matchStatisticsTable).where(eq(matchStatisticsTable.sessionId, sessionId));
    res.json(stats ?? null);
  } catch (err) {
    logger.error({ err }, "Failed to load Ball Boi statistics");
    res.status(500).json({ error: "Failed to load statistics" });
  }
});

router.get("/ball-boi/sessions/:sessionId/replay-metadata", requireAuth, async (req: Request, res: Response) => {
  try {
    const { userId } = getAuth(req);
    const sessionId = parseInt(req.params.sessionId);
    const access = await canAccessSession(sessionId, userId);
    if (!access.session) return res.status(404).json({ error: "Session not found" });
    if (!access.allowed) return res.status(403).json({ error: "Forbidden" });
    const shots = await db.select().from(matchShotsTable).where(eq(matchShotsTable.sessionId, sessionId)).orderBy(matchShotsTable.sequenceNumber);
    res.json({
      session: access.session,
      match: access.match,
      shotMarkers: shots.map((shot) => ({
        id: shot.id,
        sequenceNumber: shot.sequenceNumber,
        rallyNumber: shot.rallyNumber,
        timestampSeconds: shot.timestampSeconds,
        clipStartSeconds: shot.clipStartSeconds,
        clipEndSeconds: shot.clipEndSeconds,
        shotType: shot.shotType,
        outcome: shot.outcome,
        courtZoneName: shot.courtZoneName,
      })),
      chapters: shots.reduce<Array<{ rallyNumber: number; startSeconds: number; endSeconds: number; shotCount: number }>>((acc, shot) => {
        const last = acc.at(-1);
        if (last && last.rallyNumber === shot.rallyNumber) {
          last.endSeconds = shot.clipEndSeconds ?? shot.timestampSeconds;
          last.shotCount += 1;
        } else {
          acc.push({
            rallyNumber: shot.rallyNumber,
            startSeconds: shot.clipStartSeconds ?? Math.max(0, shot.timestampSeconds - 4),
            endSeconds: shot.clipEndSeconds ?? shot.timestampSeconds + 4,
            shotCount: 1,
          });
        }
        return acc;
      }, []),
    });
  } catch (err) {
    logger.error({ err }, "Failed to load Ball Boi metadata");
    res.status(500).json({ error: "Failed to load metadata" });
  }
});

router.get("/ball-boi/sessions/:sessionId/video-url", requireAuth, async (req: Request, res: Response) => {
  try {
    const { userId } = getAuth(req);
    const sessionId = parseInt(req.params.sessionId);
    if (isNaN(sessionId)) return res.status(400).json({ error: "Invalid session id" });
    const access = await canAccessSession(sessionId, userId);
    if (!access.session) return res.status(404).json({ error: "Session not found" });
    if (!access.allowed) return res.status(403).json({ error: "Forbidden" });
    if (!access.session.videoObjectPath) return res.status(404).json({ error: "No video available for this session" });
    const signedUrl = await storage.getObjectEntityViewURL(access.session.videoObjectPath);
    res.json({ sessionId, videoUrl: signedUrl });
  } catch (err) {
    logger.error({ err }, "Failed to get Ball Boi video URL");
    res.status(500).json({ error: "Failed to get video URL" });
  }
});

router.get("/ball-boi/sessions/:sessionId/narrative", requireAuth, async (req: Request, res: Response) => {
  try {
    const { userId } = getAuth(req);
    const sessionId = parseInt(req.params.sessionId);
    const access = await canAccessSession(sessionId, userId);
    if (!access.session) return res.status(404).json({ error: "Session not found" });
    if (!access.allowed) return res.status(403).json({ error: "Forbidden" });
    res.json({ sessionId, narrative: access.session.aiNarrative });
  } catch (err) {
    logger.error({ err }, "Failed to load Ball Boi narrative");
    res.status(500).json({ error: "Failed to load narrative" });
  }
});

router.post("/ball-boi/detect-court", requireAuth, async (req: Request, res: Response) => {
  try {
    const frameImage: string | undefined = req.body?.frameImage;
    if (!frameImage) return res.status(400).json({ error: "frameImage is required" });

    let mlRes: globalThis.Response;
    try {
      mlRes = await fetch(`${ML_SERVICE_URL}/detect-court-lines`, {
        method: "POST",
        headers: { "Content-Type": "application/json", ...(ML_SECRET ? { "X-ML-Secret": ML_SECRET } : {}) },
        body: JSON.stringify({ frame_image: frameImage }),
        signal: AbortSignal.timeout(10000),
      });
    } catch (mlErr) {
      if (isMlServiceUnreachable(mlErr)) {
        return res.status(503).json({ success: false, error: "Analysis service is temporarily unavailable — try manual calibration" });
      }
      throw mlErr;
    }

    const data = await mlRes.json();
    res.status(mlRes.ok ? 200 : 502).json(data);
  } catch (err) {
    logger.error({ err }, "Court auto-detection failed");
    res.status(500).json({ success: false, error: "Court detection failed" });
  }
});

router.get("/ball-boi/matches/:matchId/sessions", requireAuth, async (req: Request, res: Response) => {
  try {
    const { userId } = getAuth(req);
    const matchId = parseInt(req.params.matchId);
    const access = await canAccessMatch(matchId, userId);
    if (!access.match) return res.status(404).json({ error: "Match not found" });
    if (!access.allowed) return res.status(403).json({ error: "Forbidden" });
    const sessions = await db.select().from(ballBoiSessionsTable).where(eq(ballBoiSessionsTable.matchId, matchId)).orderBy(desc(ballBoiSessionsTable.createdAt));
    res.json(sessions);
  } catch (err) {
    logger.error({ err }, "Failed to load Ball Boi sessions");
    res.status(500).json({ error: "Failed to load sessions" });
  }
});

export default router;