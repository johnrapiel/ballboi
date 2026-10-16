import { Router, type IRouter, type Request, type Response } from "express";
import { Readable } from "stream";
import {
  RequestUploadUrlBody,
  RequestUploadUrlResponse,
} from "@workspace/api-zod";
import { ObjectStorageService, ObjectNotFoundError } from "../lib/objectStorage";
import { getAuth } from "@clerk/express";
import { db } from "@workspace/db";
import { ballBoiSessionsTable, leaguesTable, matchesTable, playersTable } from "@workspace/db";
import { eq } from "drizzle-orm";

const router: IRouter = Router();
const objectStorageService = new ObjectStorageService();
const ML_SECRET = process.env.ML_SECRET;

async function canReadBallBoiObject(objectPath: string, req: Request) {
  const [session] = await db.select().from(ballBoiSessionsTable).where(eq(ballBoiSessionsTable.videoObjectPath, objectPath));
  if (!session) return true;
  if (ML_SECRET && req.headers["x-ml-secret"] === ML_SECRET) return true;
  const { userId } = getAuth(req);
  if (!userId) return false;
  if (session.recordedByClerkUserId === userId) return true;
  const [match] = await db.select().from(matchesTable).where(eq(matchesTable.id, session.matchId));
  if (!match) return false;
  const callerPlayers = await db.select().from(playersTable).where(eq(playersTable.clerkUserId, userId));
  const callerPlayer = callerPlayers[0] ?? null;
  const participantIds = [match.player1Id, match.player2Id, match.player3Id, match.player4Id].filter((id): id is number => id != null);
  if (callerPlayer && participantIds.includes(callerPlayer.id)) return true;
  if (match.leagueId != null) {
    const [league] = await db.select().from(leaguesTable).where(eq(leaguesTable.id, match.leagueId));
    if (league?.createdByClerkUserId === userId) return true;
  }
  return false;
}

/**
 * POST /storage/uploads/request-url
 *
 * Request a presigned URL for file upload.
 * The client sends JSON metadata (name, size, contentType) — NOT the file.
 * Then uploads the file directly to the returned presigned URL.
 */
router.post("/storage/uploads/request-url", async (req: Request, res: Response) => {
  const parsed = RequestUploadUrlBody.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: "Missing or invalid required fields" });
    return;
  }

  try {
    const { name, size, contentType } = parsed.data;

    const uploadURL = await objectStorageService.getObjectEntityUploadURL();
    const objectPath = objectStorageService.normalizeObjectEntityPath(uploadURL);

    res.json(
      RequestUploadUrlResponse.parse({
        uploadURL,
        objectPath,
        metadata: { name, size, contentType },
      }),
    );
  } catch (error) {
    req.log.error({ err: error }, "Error generating upload URL");
    res.status(500).json({ error: "Failed to generate upload URL" });
  }
});

/**
 * GET /storage/public-objects/*
 *
 * Serve public assets from PUBLIC_OBJECT_SEARCH_PATHS.
 * These are unconditionally public — no authentication or ACL checks.
 * IMPORTANT: Always provide this endpoint when object storage is set up.
 */
router.get("/storage/public-objects/*filePath", async (req: Request, res: Response) => {
  try {
    const raw = req.params.filePath;
    const filePath = Array.isArray(raw) ? raw.join("/") : raw;
    const file = await objectStorageService.searchPublicObject(filePath);
    if (!file) {
      res.status(404).json({ error: "File not found" });
      return;
    }

    const response = await objectStorageService.downloadObject(file, 3600, true);

    res.status(response.status);
    response.headers.forEach((value, key) => res.setHeader(key, value));

    if (response.body) {
      const nodeStream = Readable.fromWeb(response.body as ReadableStream<Uint8Array>);
      nodeStream.pipe(res);
    } else {
      res.end();
    }
  } catch (error) {
    req.log.error({ err: error }, "Error serving public object");
    res.status(500).json({ error: "Failed to serve public object" });
  }
});

/**
 * GET /storage/objects/*
 *
 * Serve object entities from PRIVATE_OBJECT_DIR.
 * These are served from a separate path from /public-objects and can optionally
 * be protected with authentication or ACL checks based on the use case.
 */
router.get("/storage/objects/*path", async (req: Request, res: Response) => {
  try {
    const raw = req.params.path;
    const wildcardPath = Array.isArray(raw) ? raw.join("/") : raw;
    const objectPath = `/objects/${wildcardPath}`;
    const objectFile = await objectStorageService.getObjectEntityFile(objectPath);
    const canReadBallBoi = await canReadBallBoiObject(objectPath, req);
    if (!canReadBallBoi) {
      res.status(403).json({ error: "Forbidden" });
      return;
    }

    const response = await objectStorageService.downloadObject(objectFile);

    res.status(response.status);
    response.headers.forEach((value, key) => res.setHeader(key, value));

    if (response.body) {
      const nodeStream = Readable.fromWeb(response.body as ReadableStream<Uint8Array>);
      nodeStream.pipe(res);
    } else {
      res.end();
    }
  } catch (error) {
    if (error instanceof ObjectNotFoundError) {
      req.log.warn({ err: error }, "Object not found");
      res.status(404).json({ error: "Object not found" });
      return;
    }
    req.log.error({ err: error }, "Error serving object");
    res.status(500).json({ error: "Failed to serve object" });
  }
});

export default router;
