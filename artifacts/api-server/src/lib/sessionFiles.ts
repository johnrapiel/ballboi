// Deletes everything in storage that belongs to one recording, before its
// session row is removed (Remove on a failed or lost recording, Discard).
// Best effort: a failure is logged and never blocks the removal. R2 also
// clears unfinished multipart uploads on its own after 7 days.

import { logger } from "./logger";
import { segmentUploads } from "./multipartUpload";
import { segmentPathsOf } from "./mlDispatch";
import { ObjectStorageService } from "./objectStorage";

export interface SessionFilesLike {
  id: number;
  videoObjectPath: string | null;
  metadata: unknown;
}

export interface FileStore {
  abortMultipartUpload(objectPath: string, uploadId: string): Promise<void>;
  deleteObject(objectPath: string): Promise<void>;
}

let defaultStore: FileStore | null = null;

/** Every stored path and unfinished upload of this recording. */
export function sessionFiles(session: SessionFilesLike): { objects: string[]; unfinished: { objectPath: string; uploadId: string }[] } {
  const uploads = Object.values(segmentUploads(session.metadata));
  const m = session.metadata && typeof session.metadata === "object" ? (session.metadata as Record<string, unknown>) : {};
  const training = typeof m.trainingVideoPath === "string" ? m.trainingVideoPath : null;
  const objects = new Set<string>();
  if (session.videoObjectPath) objects.add(session.videoObjectPath);
  for (const p of segmentPathsOf(session.metadata)) objects.add(p);
  if (training) objects.add(training);
  for (const u of uploads) if (u.completedAt) objects.add(u.objectPath);
  return {
    objects: [...objects],
    unfinished: uploads.filter((u) => !u.completedAt).map((u) => ({ objectPath: u.objectPath, uploadId: u.uploadId })),
  };
}

export async function deleteSessionFiles(session: SessionFilesLike, store?: FileStore): Promise<void> {
  const s = store ?? (defaultStore ??= new ObjectStorageService());
  const { objects, unfinished } = sessionFiles(session);
  for (const u of unfinished) {
    try {
      await s.abortMultipartUpload(u.objectPath, u.uploadId);
    } catch (err) {
      logger.warn({ err, sessionId: session.id }, "Couldn't stop an unfinished upload; storage clears it after 7 days");
    }
  }
  for (const path of objects) {
    try {
      await s.deleteObject(path);
    } catch (err) {
      logger.warn({ err, sessionId: session.id }, "Couldn't delete a recording file");
    }
  }
}
