import { Router, type IRouter, type Request, type Response } from "express";
import { pipeline } from "stream/promises";
import {
  RequestUploadUrlBody,
  RequestUploadUrlResponse,
} from "@workspace/api-zod";
import { ObjectStorageService, ObjectNotFoundError } from "../lib/objectStorage";
import { db } from "@workspace/db";
import { ballBoiSessionsTable } from "@workspace/db";
import { eq } from "drizzle-orm";
import { getAuth } from "@clerk/express";
import { isCurrentPhoto, isPhotoType, uploadRequestProblem } from "../lib/profilePhoto";

const router: IRouter = Router();
const objectStorageService = new ObjectStorageService();
const ML_SECRET = process.env.ML_SECRET;

// Spec (Video and training data): match video is never shown in the app. Ball
// Boi video, the raw upload and the training copy alike, streams only to the
// ML server (X-ML-Secret). Other uploads are unaffected.
export const TRAINING_PREFIX = "/objects/training/";

export async function isBallBoiVideo(objectPath: string): Promise<boolean> {
  if (objectPath.startsWith(TRAINING_PREFIX)) return true;
  const [session] = await db.select().from(ballBoiSessionsTable).where(eq(ballBoiSessionsTable.videoObjectPath, objectPath));
  return !!session;
}

function fromMlServer(req: Request): boolean {
  return !!ML_SECRET && req.headers["x-ml-secret"] === ML_SECRET;
}

/**
 * POST /storage/uploads/request-url
 *
 * Request a presigned URL for file upload.
 * The client sends JSON metadata (name, size, contentType) — NOT the file.
 * Then uploads the file directly to the returned presigned URL.
 */
router.post("/storage/uploads/request-url", async (req: Request, res: Response) => {
  if (!getAuth(req).userId) {
    res.status(401).json({ error: "Unauthorized" });
    return;
  }
  const parsed = RequestUploadUrlBody.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: "Missing or invalid required fields" });
    return;
  }
  // Profile photos only (A17): images up to 10 MB. The saved file is checked
  // again when the profile is saved (lib/profilePhoto.ts).
  const problem = uploadRequestProblem(parsed.data);
  if (problem) {
    res.status(400).json({ error: problem });
    return;
  }

  try {
    const { name, size, contentType } = parsed.data;

    const { uploadURL, objectPath } = await objectStorageService.createUploadURL();

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
 * GET /storage/objects/*
 *
 * Stream an uploaded object through the API. The ML server (X-ML-Secret) can
 * read any object; that's how it downloads Ball Boi video. Everyone else must
 * be signed in (A17), and gets only current profile photos: the app sends its
 * sign-in header with each photo request (components/Avatar.tsx). A replaced
 * or removed photo stops loading.
 */
router.get("/storage/objects/*path", async (req: Request, res: Response) => {
  try {
    const raw = req.params.path;
    const wildcardPath = Array.isArray(raw) ? raw.join("/") : raw;
    const objectPath = `/objects/${wildcardPath}`;
    const ml = fromMlServer(req);
    if (!ml && !getAuth(req).userId) {
      res.status(401).json({ error: "Unauthorized" });
      return;
    }
    if (!ml && (await isBallBoiVideo(objectPath))) {
      res.status(403).json({ error: "Forbidden" });
      return;
    }
    if (!ml && !(await isCurrentPhoto(objectPath))) {
      res.status(404).json({ error: "Object not found" });
      return;
    }

    const object = await objectStorageService.getObject(objectPath);
    if (!ml && !isPhotoType(object.contentType)) {
      object.body.destroy();
      res.status(404).json({ error: "Object not found" });
      return;
    }
    res.setHeader("X-Content-Type-Options", "nosniff");
    res.setHeader("Content-Type", object.contentType);
    res.setHeader("Cache-Control", "private, max-age=3600");
    if (object.contentLength != null) {
      res.setHeader("Content-Length", String(object.contentLength));
    }
    await pipeline(object.body, res);
  } catch (error) {
    if (res.headersSent) {
      req.log.warn({ err: error }, "Object stream ended early");
      return;
    }
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
