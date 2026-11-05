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
import { and, desc, eq, inArray, sql } from "drizzle-orm";
import { ObjectNotFoundError, ObjectStorageService } from "../lib/objectStorage";
import { logger } from "../lib/logger";
import { gateNarrative, gateSession, gateShot, gateStatistics, hiddenStats, shownStats } from "../lib/statGates";
import {
  asRecord,
  stringOrNull,
  normalizeNumber,
  courtCalibrationFromMetadata,
  buildShotFromResult,
  structuredShotFields,
  computeStats,
  buildNarrative,
  type UnknownRecord,
} from "../lib/ballBoiUtils";
import { computeNextRetryAt } from "../services/ballBoiRetry";
import { isMlServiceUnreachable } from "../lib/mlServiceErrors";
import { keepForTraining, settleSessionVideo } from "../lib/videoRetention";
import {
  missingParts,
  partCountFor,
  partSizeFor,
  partsComplete,
  segmentUploads,
  validSegment,
  validSegmentSize,
  MAX_SEGMENTS,
  type SegmentUpload,
} from "../lib/multipartUpload";
import { mlVideoFields } from "../lib/mlDispatch";
import { parseRecordedAt } from "../lib/recordableMatches";

const router = Router();

// Re-runs a request through this router under a rewritten URL (used by the
// /matches/:matchId/ball-boi/* aliases). Express 5's types don't expose
// Router#handle, though it exists at runtime.
function dispatch(req: Request, res: Response) {
  (router as unknown as { handle: (req: Request, res: Response) => void }).handle(req, res);
}
const storage = new ObjectStorageService();

const ML_SERVICE_URL = process.env.ML_SERVICE_URL ?? "http://localhost:8000";
const ML_SECRET = process.env.ML_SECRET;
const API_BASE_URL = process.env.API_BASE_URL ?? `http://localhost:${process.env.PORT ?? 8080}`;

const ML_UNAVAILABLE_MESSAGE =
  "Analysis service is temporarily unavailable — your video has been saved and results will appear once the service is back online.";

function requireAuth(req: Request, res: Response, next: NextFunction) {
  const { userId } = getAuth(req);
  if (!userId) { res.status(401).json({ error: "Unauthorized" }); return; }
  next();
}

// One account has a player row per league, plus one for Quick matches and
// one per claimed invite, so every row counts (Wave 1 review D3: checking
// only the first row turned away anyone in two leagues).
async function canAccessMatch(matchId: number, userId: string) {
  const [match] = await db.select().from(matchesTable).where(eq(matchesTable.id, matchId));
  if (!match) return { allowed: false, match: null };
  const callerPlayers = await db.select({ id: playersTable.id }).from(playersTable).where(eq(playersTable.clerkUserId, userId));
  const mine = new Set(callerPlayers.map((p) => p.id));
  const participantIds = [match.player1Id, match.player2Id, match.player3Id, match.player4Id].filter((id): id is number => id != null);
  const isParticipant = participantIds.some((id) => mine.has(id));
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
  const modelVersion = stringOrNull(asRecord(payload.model).version);
  const shots = resultShots.map((shotResult: unknown, i: number) => {
    const shotPayload = asRecord(shotResult);
    // The pipeline says which side of the net hit each shot, not which player:
    // players switch ends, so the side alone can't name them. Leave playerId
    // empty rather than guess; legacy results without a side keep the old fill.
    const fromPipeline = typeof shotPayload.hitter === "string";
    const withPlayer = {
      ...shotPayload,
      playerId: shotPayload.playerId ?? (fromPipeline ? null : participantIds[i % Math.max(participantIds.length, 1)] ?? null),
    };
    const shot = buildShotFromResult(
      withPlayer,
      normalizeNumber(shotPayload.sequenceNumber, i + 1),
      matchId,
      sessionId,
      normalizeNumber(shotPayload.timestampSeconds, duration ? Math.min(duration, i * Math.max(4, duration / resultShots.length)) : i * 8),
      normalizeNumber(shotPayload.rallyNumber, Math.floor(i / 5) + 1),
    );
    return { ...shot, ...structuredShotFields(shotPayload, modelVersion) };
  });

  const inserted = await db.insert(matchShotsTable).values(shots).returning();
  const stats = computeStats(inserted, players);
  const allPlayers = await db
    .select({ id: playersTable.id, name: playersTable.name })
    .from(playersTable)
    .where(inArray(playersTable.id, match ? [match.player1Id, match.player2Id] : []));
  const pMap: Record<number, string> = {};
  for (const p of allPlayers) pMap[p.id] = p.name;
  const matchTitle = match ? `${pMap[match.player1Id] ?? "Player 1"} vs ${pMap[match.player2Id] ?? "Player 2"}` : "The match";
  const aiNarrative = buildNarrative(matchTitle, stats, inserted);

  await db.insert(matchStatisticsTable).values({ sessionId, matchId, ...stats });
  // Which stats the app may show, decided by the eval for this exact pipeline
  // (lib/statGates.ts). No gates means every stat stays hidden.
  const statGates = asRecord(payload.statGates);
  await db.update(ballBoiSessionsTable).set({
    status: "completed",
    processingStatus: "completed",
    processingError: null,
    metadata: sql`coalesce(${ballBoiSessionsTable.metadata}, '{}'::jsonb) || ${JSON.stringify({ statGates })}::jsonb`,
    aiNarrative,
    durationSeconds: Math.round(duration || normalizeNumber(asRecord(payload.metadata).durationSeconds, 0)),
  }).where(eq(ballBoiSessionsTable.id, sessionId));
}

// Once analysis has finished: delete the raw upload (it has the audio) and keep
// the ML server's video-only copy only if every player left training on.
async function settleVideoAfterAnalysis(sessionId: number, result: unknown) {
  try {
    const trainingVideoKey = stringOrNull(asRecord(result).trainingVideoKey);
    const [session] = await db.select().from(ballBoiSessionsTable).where(eq(ballBoiSessionsTable.id, sessionId));
    if (!session) return;
    if (session.status === "completed") {
      await settleSessionVideo(session, trainingVideoKey);
    } else if (trainingVideoKey) {
      // No shots found: the raw upload waits out the failed-analysis grace period; the sweep settles both.
      const metadata = asRecord(session.metadata);
      await db.update(ballBoiSessionsTable).set({ metadata: { ...metadata, trainingVideoPath: trainingVideoKey } })
        .where(eq(ballBoiSessionsTable.id, sessionId));
    }
  } catch (err) {
    logger.error({ err, sessionId }, "Video retention after analysis failed; the hourly sweep will retry");
  }
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
    if (!userId) { res.status(401).json({ error: "Unauthorized" }); return; }
    const matchId = parseInt(String(req.params.matchId));
    if (isNaN(matchId)) { res.status(400).json({ error: "Invalid match id" }); return; }
    const access = await canAccessMatch(matchId, userId);
    if (!access.match) { res.status(404).json({ error: "Match not found" }); return; }
    if (!access.allowed) { res.status(403).json({ error: "Forbidden" }); return; }
    // Only plain facts from the phone go into metadata; the server's own keys
    // (callback token, uploads, stat gates) are never taken from a request.
    const sent = asRecord(req.body?.metadata);
    const metadata: Record<string, unknown> = {};
    if (typeof sent.source === "string" && sent.source.length <= 20) metadata.source = sent.source;
    const [session] = await db.insert(ballBoiSessionsTable).values({
      matchId,
      recordedByClerkUserId: userId,
      status: "recording",
      processingStatus: "pending",
      // When the match was recorded, not when the upload started (D19), so a
      // card uploaded on Wednesday for Monday's match says Monday.
      recordingStartedAt: parseRecordedAt(req.body?.recordedAt, new Date()),
      metadata,
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
    if (!userId) { res.status(401).json({ error: "Unauthorized" }); return; }
    const sessionId = parseInt(String(req.params.sessionId));
    if (isNaN(sessionId)) { res.status(400).json({ error: "Invalid session id" }); return; }
    const [session] = await db.select().from(ballBoiSessionsTable).where(eq(ballBoiSessionsTable.id, sessionId));
    if (!session) { res.status(404).json({ error: "Session not found" }); return; }
    if (session.recordedByClerkUserId !== userId) { res.status(403).json({ error: "Forbidden" }); return; }
    const { uploadURL, objectPath } = await storage.createUploadURL();
    res.json({ uploadURL, objectPath });
  } catch (err) {
    logger.error({ err }, "Failed to create Ball Boi upload URL");
    res.status(500).json({ error: "Failed to create upload URL" });
  }
});

/**
 * The recorder's own session, still waiting for its video. Sends the error
 * and returns null otherwise.
 */
async function ownUploadingSession(req: Request, res: Response) {
  const { userId } = getAuth(req);
  if (!userId) { res.status(401).json({ error: "Unauthorized" }); return null; }
  const sessionId = parseInt(String(req.params.sessionId));
  if (isNaN(sessionId)) { res.status(400).json({ error: "Invalid session id" }); return null; }
  const [session] = await db.select().from(ballBoiSessionsTable).where(eq(ballBoiSessionsTable.id, sessionId));
  if (!session) { res.status(404).json({ error: "Session not found" }); return null; }
  if (session.recordedByClerkUserId !== userId) { res.status(403).json({ error: "Forbidden" }); return null; }
  // The phone's last try finished but its answer was lost: nothing more to send.
  if (session.status !== "recording") { res.status(409).json({ error: "This recording is already uploaded.", uploaded: true }); return null; }
  return session;
}

async function saveUpload(session: typeof ballBoiSessionsTable.$inferSelect, segment: number, upload: SegmentUpload | null) {
  const metadata = asRecord(session.metadata);
  const uploads = { ...segmentUploads(metadata) };
  if (upload) uploads[String(segment)] = upload;
  else delete uploads[String(segment)];
  const next = { ...metadata, uploads };
  await db.update(ballBoiSessionsTable).set({ metadata: next }).where(eq(ballBoiSessionsTable.id, session.id));
  session.metadata = next;
}

function uploadView(upload: SegmentUpload, uploadedParts: number[]) {
  const partCount = partCountFor(upload.sizeBytes, upload.partSize);
  return {
    objectPath: upload.objectPath,
    sizeBytes: upload.sizeBytes,
    partSize: upload.partSize,
    partCount,
    uploadedParts,
    missingParts: upload.completedAt ? [] : missingParts(partCount, uploadedParts),
    completed: !!upload.completedAt,
  };
}

/**
 * POST /ball-boi/sessions/:sessionId/multipart { segment, sizeBytes }
 * Starts sending one piece of a recording in parts, or picks up where an
 * earlier try left off: the answer lists the parts storage already has, so
 * the phone sends only the rest (Wave 1 review D4).
 */
router.post("/ball-boi/sessions/:sessionId/multipart", requireAuth, async (req: Request, res: Response) => {
  try {
    const session = await ownUploadingSession(req, res);
    if (!session) return;
    const segment = req.body?.segment ?? 0;
    const sizeBytes = req.body?.sizeBytes;
    if (!validSegment(segment)) { res.status(400).json({ error: `segment must be a whole number from 0 to ${MAX_SEGMENTS - 1}` }); return; }
    if (!validSegmentSize(sizeBytes)) { res.status(400).json({ error: "sizeBytes must be the file's size in bytes" }); return; }
    let upload: SegmentUpload | undefined = segmentUploads(session.metadata)[String(segment)];
    if (upload && upload.sizeBytes !== sizeBytes) {
      // A different file for this piece: start over.
      if (!upload.completedAt) await storage.abortMultipartUpload(upload.objectPath, upload.uploadId).catch(() => {});
      upload = undefined;
    }
    if (upload?.completedAt) {
      res.json(uploadView(upload, Array.from({ length: partCountFor(upload.sizeBytes, upload.partSize) }, (_, i) => i + 1)));
      return;
    }
    if (upload) {
      try {
        const parts = await storage.listUploadedParts(upload.objectPath, upload.uploadId);
        res.json(uploadView(upload, parts.map((p) => p.partNumber)));
        return;
      } catch (err) {
        if (!(err instanceof ObjectNotFoundError)) throw err;
        // Storage dropped the unfinished upload (R2 does after 7 days): start a new one.
      }
    }
    const created = await storage.createMultipartUpload("video/quicktime");
    const fresh: SegmentUpload = { ...created, sizeBytes, partSize: partSizeFor(sizeBytes) };
    await saveUpload(session, segment, fresh);
    res.json(uploadView(fresh, []));
  } catch (err) {
    logger.error({ err }, "Failed to start a multipart upload");
    res.status(500).json({ error: "Couldn't start the upload. Try again." });
  }
});

/**
 * POST /ball-boi/sessions/:sessionId/multipart/part-url { segment, partNumber }
 * A presigned PUT address for one part, good for an hour.
 */
router.post("/ball-boi/sessions/:sessionId/multipart/part-url", requireAuth, async (req: Request, res: Response) => {
  try {
    const session = await ownUploadingSession(req, res);
    if (!session) return;
    const segment = req.body?.segment ?? 0;
    const partNumber = req.body?.partNumber;
    if (!validSegment(segment)) { res.status(400).json({ error: "Invalid segment" }); return; }
    const upload = segmentUploads(session.metadata)[String(segment)];
    if (!upload || upload.completedAt) { res.status(409).json({ error: "Start this upload first." }); return; }
    const count = partCountFor(upload.sizeBytes, upload.partSize);
    if (typeof partNumber !== "number" || !Number.isInteger(partNumber) || partNumber < 1 || partNumber > count) {
      res.status(400).json({ error: `partNumber must be from 1 to ${count}` });
      return;
    }
    const url = await storage.createUploadPartURL(upload.objectPath, upload.uploadId, partNumber);
    res.json({ url, partNumber });
  } catch (err) {
    logger.error({ err }, "Failed to create a part upload URL");
    res.status(500).json({ error: "Couldn't create the upload address. Try again." });
  }
});

/**
 * POST /ball-boi/sessions/:sessionId/multipart/complete { segment }
 * Joins the parts into one stored video once storage has every part. Safe
 * to call again: a piece that's already joined just answers with its path.
 */
router.post("/ball-boi/sessions/:sessionId/multipart/complete", requireAuth, async (req: Request, res: Response) => {
  try {
    const session = await ownUploadingSession(req, res);
    if (!session) return;
    const segment = req.body?.segment ?? 0;
    if (!validSegment(segment)) { res.status(400).json({ error: "Invalid segment" }); return; }
    const upload = segmentUploads(session.metadata)[String(segment)];
    if (!upload) { res.status(409).json({ error: "Start this upload first." }); return; }
    if (upload.completedAt) { res.json({ objectPath: upload.objectPath, sizeBytes: upload.sizeBytes }); return; }
    let parts;
    try {
      parts = await storage.listUploadedParts(upload.objectPath, upload.uploadId);
    } catch (err) {
      if (!(err instanceof ObjectNotFoundError)) throw err;
      // Joined already, but the answer never reached the phone: the object is there.
      const head = await storage.headObject(upload.objectPath).catch(() => null);
      if (head && head.contentLength === upload.sizeBytes) {
        await saveUpload(session, segment, { ...upload, completedAt: new Date().toISOString() });
        res.json({ objectPath: upload.objectPath, sizeBytes: upload.sizeBytes });
        return;
      }
      await saveUpload(session, segment, null);
      res.status(409).json({ error: "This upload expired. Start it again.", restart: true });
      return;
    }
    const count = partCountFor(upload.sizeBytes, upload.partSize);
    if (!partsComplete(upload, parts)) {
      res.status(409).json({ error: "Some parts are missing.", missingParts: missingParts(count, parts.map((p) => p.partNumber)) });
      return;
    }
    await storage.completeMultipartUpload(upload.objectPath, upload.uploadId, parts.filter((p) => p.partNumber <= count));
    await saveUpload(session, segment, { ...upload, completedAt: new Date().toISOString() });
    res.json({ objectPath: upload.objectPath, sizeBytes: upload.sizeBytes });
  } catch (err) {
    logger.error({ err }, "Failed to finish a multipart upload");
    res.status(500).json({ error: "Couldn't finish the upload. Try again." });
  }
});

router.post("/ball-boi/sessions/:sessionId/cancel", requireAuth, async (req: Request, res: Response) => {
  try {
    const { userId } = getAuth(req);
    if (!userId) { res.status(401).json({ error: "Unauthorized" }); return; }
    const sessionId = parseInt(String(req.params.sessionId));
    if (isNaN(sessionId)) { res.status(400).json({ error: "Invalid session id" }); return; }
    const [session] = await db.select().from(ballBoiSessionsTable).where(eq(ballBoiSessionsTable.id, sessionId));
    if (!session) { res.status(404).json({ error: "Session not found" }); return; }
    if (session.recordedByClerkUserId !== userId) { res.status(403).json({ error: "Forbidden" }); return; }
    if (session.status !== "recording") { res.status(409).json({ error: "Only active recording sessions can be cancelled" }); return; }
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
    if (!userId) { res.status(401).json({ error: "Unauthorized" }); return; }
    const sessionId = parseInt(String(req.params.sessionId));
    const [session] = await db.select().from(ballBoiSessionsTable).where(eq(ballBoiSessionsTable.id, sessionId));
    if (!session) { res.status(404).json({ error: "Session not found" }); return; }
    if (session.recordedByClerkUserId !== userId) { res.status(403).json({ error: "Forbidden" }); return; }
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
    if (!liveShotResult) { res.status(204).send(); return; }
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

/** A 32-bit column; the size is informational only. */
const MAX_INT32 = 2_147_483_647;

interface SentSegment { objectPath: string; sizeBytes: number; durationSeconds: number }

/** The pieces the phone says make up this recording, in order. Null when the list isn't usable. */
function readSegments(body: UnknownRecord): SentSegment[] | null {
  const raw = body.segments;
  if (raw == null) return [];
  if (!Array.isArray(raw) || raw.length > MAX_SEGMENTS) return null;
  const out: SentSegment[] = [];
  for (const item of raw) {
    const r = asRecord(item);
    if (typeof r.objectPath !== "string" || !r.objectPath.startsWith("/objects/")) return null;
    out.push({ objectPath: r.objectPath, sizeBytes: normalizeNumber(r.sizeBytes, 0), durationSeconds: normalizeNumber(r.durationSeconds, 0) });
  }
  return out;
}

router.post("/ball-boi/sessions/:sessionId/complete", requireAuth, async (req: Request, res: Response) => {
  try {
    const { userId } = getAuth(req);
    if (!userId) { res.status(401).json({ error: "Unauthorized" }); return; }
    const sessionId = parseInt(String(req.params.sessionId));
    const [session] = await db.select().from(ballBoiSessionsTable).where(eq(ballBoiSessionsTable.id, sessionId));
    if (!session) { res.status(404).json({ error: "Session not found" }); return; }
    if (session.recordedByClerkUserId !== userId) { res.status(403).json({ error: "Forbidden" }); return; }
    // Told twice (the first answer was lost and the phone tried again):
    // analysis already started, so answer with the session and start nothing (D33).
    if (session.status !== "recording") { res.json(session); return; }
    const body = asRecord(req.body);
    const segments = readSegments(body);
    const objectPath = segments && segments.length > 0 ? segments[0].objectPath : body.objectPath;
    if (!objectPath || typeof objectPath !== "string") { res.status(400).json({ error: "objectPath required" }); return; }
    if (!segments) { res.status(400).json({ error: "segments must be a list of uploaded pieces" }); return; }
    // Sent in parts: every piece must be one this session uploaded and joined.
    const uploads = Object.values(segmentUploads(session.metadata));
    const paths = segments.length > 0 ? segments.map((x) => x.objectPath) : [objectPath];
    if (uploads.length > 0) {
      const joined = new Set(uploads.filter((u) => u.completedAt).map((u) => u.objectPath));
      if (!paths.every((p) => joined.has(p))) { res.status(409).json({ error: "Finish uploading every part first." }); return; }
    }
    const extraPaths = paths.slice(1);
    const totalSeconds = segments.length > 0
      ? segments.reduce((sum, x) => sum + x.durationSeconds, 0)
      : normalizeNumber(body.durationSeconds, 0);
    const totalBytes = segments.length > 0 ? segments.reduce((sum, x) => sum + x.sizeBytes, 0) : normalizeNumber(body.sizeBytes, 0);
    const metadata = asRecord(session.metadata);
    const mlCallbackToken = typeof metadata.mlCallbackToken === "string" ? metadata.mlCallbackToken : randomUUID();
    const startedMetadata: Record<string, unknown> = {
      ...metadata,
      mlCallbackToken,
      chunks: Array.isArray(body.chunks) ? body.chunks : [],
      analysisStartedAt: new Date().toISOString(),
      ...(extraPaths.length > 0 ? { segmentPaths: extraPaths } : {}),
    };
    // Only one call moves the session on, so analysis starts once.
    const [updated] = await db.update(ballBoiSessionsTable).set({
      status: "processing",
      processingStatus: "processing",
      recordingStoppedAt: new Date(),
      videoObjectPath: objectPath,
      videoContentType: typeof body.contentType === "string" ? body.contentType : null,
      videoSizeBytes: totalBytes > 0 ? Math.min(Math.round(totalBytes), MAX_INT32) : null,
      durationSeconds: Math.round(totalSeconds),
      metadata: startedMetadata,
    }).where(and(eq(ballBoiSessionsTable.id, sessionId), eq(ballBoiSessionsTable.status, "recording"))).returning();
    if (!updated) {
      const [current] = await db.select().from(ballBoiSessionsTable).where(eq(ballBoiSessionsTable.id, sessionId));
      res.json(current ?? session);
      return;
    }

    const callbackUrl = `${API_BASE_URL}/api/ball-boi/sessions/${sessionId}/ml-callback?token=${encodeURIComponent(mlCallbackToken)}`;
    try {
      const mlRes = await fetch(`${ML_SERVICE_URL}/analyze-match-batch`, {
        method: "POST",
        headers: { "Content-Type": "application/json", ...(ML_SECRET ? { "X-ML-Secret": ML_SECRET } : {}) },
        body: JSON.stringify({
          ...mlVideoFields(API_BASE_URL, objectPath, extraPaths),
          session_id: sessionId,
          match_id: session.matchId,
          callback_url: callbackUrl,
          court_calibration: courtCalibrationFromMetadata(session.metadata),
          keep_for_training: await keepForTraining(session.matchId),
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
        const failedMetadata = isUnreachable
          ? { ...startedMetadata, retryCount: 0, nextRetryAt: computeNextRetryAt(0).toISOString() }
          : startedMetadata;
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
    const sessionId = parseInt(String(req.params.sessionId));
    const [session] = await db.select().from(ballBoiSessionsTable).where(eq(ballBoiSessionsTable.id, sessionId));
    if (!session) { res.status(404).json({ error: "Session not found" }); return; }
    const callbackToken = sessionCallbackToken(session);
    const incomingSecret = req.headers["x-ml-secret"];
    const secretMatches = !!ML_SECRET && typeof incomingSecret === "string" && incomingSecret === ML_SECRET;
    const tokenMatches = !!callbackToken && req.query.token === callbackToken;
    if (ML_SECRET ? !secretMatches : !tokenMatches) { res.status(403).json({ error: "Forbidden" }); return; }
    const { status, result, error } = req.body ?? {};
    if (status === "completed" && result) {
      await saveBatchResults(sessionId, session.matchId, result);
      await settleVideoAfterAnalysis(sessionId, result);
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
    if (!userId) { res.status(401).json({ error: "Unauthorized" }); return; }
    const matchId = parseInt(String(req.params.matchId));
    if (isNaN(matchId)) { res.status(400).json({ error: "Invalid match id" }); return; }
    const access = await canAccessMatch(matchId, userId);
    if (!access.match) { res.status(404).json({ error: "Match not found" }); return; }
    if (!access.allowed) { res.status(403).json({ error: "Forbidden" }); return; }
    const sessions = await db.select().from(ballBoiSessionsTable).where(eq(ballBoiSessionsTable.matchId, matchId)).orderBy(desc(ballBoiSessionsTable.createdAt));
    const session = sessions[0] ?? null;
    if (!session) { res.json({ match: access.match, session: null, shots: [], statistics: null, hiddenStats: hiddenStats(new Set()) }); return; }
    const [shots, statsRows] = await Promise.all([
      db.select().from(matchShotsTable).where(eq(matchShotsTable.sessionId, session.id)).orderBy(matchShotsTable.sequenceNumber),
      db.select().from(matchStatisticsTable).where(eq(matchStatisticsTable.sessionId, session.id)),
    ]);
    const shown = shownStats(session.metadata);
    res.json({
      match: access.match,
      session: gateSession(session, shown),
      shots: shots.map((shot) => gateShot(shot, shown)),
      statistics: gateStatistics(statsRows[0], shown),
      hiddenStats: hiddenStats(shown),
    });
  } catch (err) {
    logger.error({ err }, "Failed to load Ball Boi replay");
    res.status(500).json({ error: "Failed to load replay" });
  }
});

router.post("/matches/:matchId/ball-boi/sessions/start", requireAuth, async (req: Request, res: Response) => {
  req.url = `/ball-boi/matches/${req.params.matchId}/sessions/start`;
  dispatch(req, res);
});

router.get("/matches/:matchId/ball-boi/replay", requireAuth, async (req: Request, res: Response) => {
  req.url = `/ball-boi/matches/${req.params.matchId}/replay`;
  dispatch(req, res);
});

async function latestSessionForMatch(matchId: number) {
  const sessions = await db.select().from(ballBoiSessionsTable).where(eq(ballBoiSessionsTable.matchId, matchId)).orderBy(desc(ballBoiSessionsTable.createdAt));
  return sessions[0] ?? null;
}

router.post("/matches/:matchId/ball-boi/end", requireAuth, async (req: Request, res: Response) => {
  try {
    const { userId } = getAuth(req);
    if (!userId) { res.status(401).json({ error: "Unauthorized" }); return; }
    const matchId = parseInt(String(req.params.matchId));
    const access = await canAccessMatch(matchId, userId);
    if (!access.match) { res.status(404).json({ error: "Match not found" }); return; }
    if (!access.allowed) { res.status(403).json({ error: "Forbidden" }); return; }
    const session = await latestSessionForMatch(matchId);
    if (!session) { res.status(404).json({ error: "Ball Boi session not found" }); return; }
    const { objectPath, contentType, sizeBytes, durationSeconds } = req.body ?? {};
    if (!objectPath) { res.status(400).json({ error: "objectPath required" }); return; }
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
          keep_for_training: await keepForTraining(session.matchId),
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
    const matchId = parseInt(String(req.params.matchId));
    const body = asRecord(req.body);
    const requestedSessionId = normalizeNumber(body.sessionId, 0);
    const session = requestedSessionId > 0
      ? (await db.select().from(ballBoiSessionsTable).where(eq(ballBoiSessionsTable.id, requestedSessionId)))[0]
      : await latestSessionForMatch(matchId);
    if (!session || session.matchId !== matchId) { res.status(404).json({ error: "Session not found" }); return; }
    const callbackToken = sessionCallbackToken(session);
    const incomingSecret = req.headers["x-ml-secret"];
    const secretMatches = !!ML_SECRET && typeof incomingSecret === "string" && incomingSecret === ML_SECRET;
    const tokenMatches = !!callbackToken && req.query.token === callbackToken;
    if (ML_SECRET ? !secretMatches : !tokenMatches) { res.status(403).json({ error: "Forbidden" }); return; }
    if (body.status === "completed" && body.result) {
      await saveBatchResults(session.id, session.matchId, body.result);
      await settleVideoAfterAnalysis(session.id, body.result);
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
    if (!userId) { res.status(401).json({ error: "Unauthorized" }); return; }
    const matchId = parseInt(String(req.params.matchId));
    const access = await canAccessMatch(matchId, userId);
    if (!access.match) { res.status(404).json({ error: "Match not found" }); return; }
    if (!access.allowed) { res.status(403).json({ error: "Forbidden" }); return; }
    const session = await latestSessionForMatch(matchId);
    if (!session) { res.json({ sessionId: null, status: "none", processingStatus: "none", processingError: null, shotCount: 0, progress: 0 }); return; }
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
    if (!userId) { res.status(401).json({ error: "Unauthorized" }); return; }
    const matchId = parseInt(String(req.params.matchId));
    const access = await canAccessMatch(matchId, userId);
    if (!access.match) { res.status(404).json({ error: "Match not found" }); return; }
    if (!access.allowed) { res.status(403).json({ error: "Forbidden" }); return; }
    const session = await latestSessionForMatch(matchId);
    if (!session) { res.json({ matchId, sessionId: null, narrative: null }); return; }
    res.json({ matchId, sessionId: session.id, narrative: gateNarrative(session.aiNarrative, shownStats(session.metadata)) });
  } catch (err) {
    logger.error({ err }, "Failed to load match Ball Boi narrative");
    res.status(500).json({ error: "Failed to load narrative" });
  }
});

router.get("/matches/:matchId/ball-boi/replay-metadata", requireAuth, async (req: Request, res: Response) => {
  try {
    const { userId } = getAuth(req);
    if (!userId) { res.status(401).json({ error: "Unauthorized" }); return; }
    const matchId = parseInt(String(req.params.matchId));
    const access = await canAccessMatch(matchId, userId);
    if (!access.match) { res.status(404).json({ error: "Match not found" }); return; }
    if (!access.allowed) { res.status(403).json({ error: "Forbidden" }); return; }
    const session = await latestSessionForMatch(matchId);
    if (!session) { res.json({ session: null, match: access.match, shotMarkers: [], chapters: [] }); return; }
    req.url = `/ball-boi/sessions/${session.id}/replay-metadata`;
    dispatch(req, res);
  } catch (err) {
    logger.error({ err }, "Failed to load match Ball Boi replay metadata");
    res.status(500).json({ error: "Failed to load metadata" });
  }
});

router.get("/matches/:matchId/shots", requireAuth, async (req: Request, res: Response) => {
  try {
    const { userId } = getAuth(req);
    if (!userId) { res.status(401).json({ error: "Unauthorized" }); return; }
    const matchId = parseInt(String(req.params.matchId));
    const access = await canAccessMatch(matchId, userId);
    if (!access.match) { res.status(404).json({ error: "Match not found" }); return; }
    if (!access.allowed) { res.status(403).json({ error: "Forbidden" }); return; }
    const session = await latestSessionForMatch(matchId);
    if (!session) { res.json([]); return; }
    const shots = await db.select().from(matchShotsTable).where(eq(matchShotsTable.sessionId, session.id)).orderBy(matchShotsTable.sequenceNumber);
    const shown = shownStats(session.metadata);
    res.json(shots.map((shot) => gateShot(shot, shown)));
  } catch (err) {
    logger.error({ err }, "Failed to load match Ball Boi shots");
    res.status(500).json({ error: "Failed to load shots" });
  }
});

router.get("/matches/:matchId/statistics", requireAuth, async (req: Request, res: Response) => {
  try {
    const { userId } = getAuth(req);
    if (!userId) { res.status(401).json({ error: "Unauthorized" }); return; }
    const matchId = parseInt(String(req.params.matchId));
    const access = await canAccessMatch(matchId, userId);
    if (!access.match) { res.status(404).json({ error: "Match not found" }); return; }
    if (!access.allowed) { res.status(403).json({ error: "Forbidden" }); return; }
    const session = await latestSessionForMatch(matchId);
    if (!session) { res.json(null); return; }
    const [stats] = await db.select().from(matchStatisticsTable).where(eq(matchStatisticsTable.sessionId, session.id));
    res.json(gateStatistics(stats, shownStats(session.metadata)));
  } catch (err) {
    logger.error({ err }, "Failed to load match Ball Boi statistics");
    res.status(500).json({ error: "Failed to load statistics" });
  }
});

router.get("/ball-boi/sessions/:sessionId/status", requireAuth, async (req: Request, res: Response) => {
  try {
    const { userId } = getAuth(req);
    if (!userId) { res.status(401).json({ error: "Unauthorized" }); return; }
    const sessionId = parseInt(String(req.params.sessionId));
    const access = await canAccessSession(sessionId, userId);
    if (!access.session) { res.status(404).json({ error: "Session not found" }); return; }
    if (!access.allowed) { res.status(403).json({ error: "Forbidden" }); return; }
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
    if (!userId) { res.status(401).json({ error: "Unauthorized" }); return; }
    const sessionId = parseInt(String(req.params.sessionId));
    const access = await canAccessSession(sessionId, userId);
    if (!access.session) { res.status(404).json({ error: "Session not found" }); return; }
    if (!access.allowed) { res.status(403).json({ error: "Forbidden" }); return; }
    const shots = await db.select().from(matchShotsTable).where(eq(matchShotsTable.sessionId, sessionId)).orderBy(matchShotsTable.sequenceNumber);
    const shown = shownStats(access.session.metadata);
    res.json(shots.map((shot) => gateShot(shot, shown)));
  } catch (err) {
    logger.error({ err }, "Failed to load Ball Boi shots");
    res.status(500).json({ error: "Failed to load shots" });
  }
});

router.get("/ball-boi/sessions/:sessionId/statistics", requireAuth, async (req: Request, res: Response) => {
  try {
    const { userId } = getAuth(req);
    if (!userId) { res.status(401).json({ error: "Unauthorized" }); return; }
    const sessionId = parseInt(String(req.params.sessionId));
    const access = await canAccessSession(sessionId, userId);
    if (!access.session) { res.status(404).json({ error: "Session not found" }); return; }
    if (!access.allowed) { res.status(403).json({ error: "Forbidden" }); return; }
    const [stats] = await db.select().from(matchStatisticsTable).where(eq(matchStatisticsTable.sessionId, sessionId));
    res.json(gateStatistics(stats, shownStats(access.session.metadata)));
  } catch (err) {
    logger.error({ err }, "Failed to load Ball Boi statistics");
    res.status(500).json({ error: "Failed to load statistics" });
  }
});

router.get("/ball-boi/sessions/:sessionId/replay-metadata", requireAuth, async (req: Request, res: Response) => {
  try {
    const { userId } = getAuth(req);
    if (!userId) { res.status(401).json({ error: "Unauthorized" }); return; }
    const sessionId = parseInt(String(req.params.sessionId));
    const access = await canAccessSession(sessionId, userId);
    if (!access.session) { res.status(404).json({ error: "Session not found" }); return; }
    if (!access.allowed) { res.status(403).json({ error: "Forbidden" }); return; }
    const shown = shownStats(access.session.metadata);
    const shots = (await db.select().from(matchShotsTable).where(eq(matchShotsTable.sessionId, sessionId)).orderBy(matchShotsTable.sequenceNumber))
      .map((shot) => gateShot(shot, shown));
    res.json({
      session: gateSession(access.session, shown),
      match: access.match,
      hiddenStats: hiddenStats(shown),
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

router.get("/ball-boi/sessions/:sessionId/narrative", requireAuth, async (req: Request, res: Response) => {
  try {
    const { userId } = getAuth(req);
    if (!userId) { res.status(401).json({ error: "Unauthorized" }); return; }
    const sessionId = parseInt(String(req.params.sessionId));
    const access = await canAccessSession(sessionId, userId);
    if (!access.session) { res.status(404).json({ error: "Session not found" }); return; }
    if (!access.allowed) { res.status(403).json({ error: "Forbidden" }); return; }
    res.json({ sessionId, narrative: gateNarrative(access.session.aiNarrative, shownStats(access.session.metadata)) });
  } catch (err) {
    logger.error({ err }, "Failed to load Ball Boi narrative");
    res.status(500).json({ error: "Failed to load narrative" });
  }
});

router.post("/ball-boi/detect-court", requireAuth, async (req: Request, res: Response) => {
  try {
    const frameImage: string | undefined = req.body?.frameImage;
    if (!frameImage) { res.status(400).json({ error: "frameImage is required" }); return; }

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
        { res.status(503).json({ success: false, error: "Analysis service is temporarily unavailable — try manual calibration" }); return; }
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
    if (!userId) { res.status(401).json({ error: "Unauthorized" }); return; }
    const matchId = parseInt(String(req.params.matchId));
    const access = await canAccessMatch(matchId, userId);
    if (!access.match) { res.status(404).json({ error: "Match not found" }); return; }
    if (!access.allowed) { res.status(403).json({ error: "Forbidden" }); return; }
    const sessions = await db.select().from(ballBoiSessionsTable).where(eq(ballBoiSessionsTable.matchId, matchId)).orderBy(desc(ballBoiSessionsTable.createdAt));
    res.json(sessions.map((s) => gateSession(s, shownStats(s.metadata))));
  } catch (err) {
    logger.error({ err }, "Failed to load Ball Boi sessions");
    res.status(500).json({ error: "Failed to load sessions" });
  }
});

export default router;