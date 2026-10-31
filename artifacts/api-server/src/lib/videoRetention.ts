// Spec (Video and training data): "Raw video deleted after analysis, unless the
// match is kept for training" and "Audio: ... deleted after processing."
//
// A session can hold two videos:
// - videoObjectPath: the raw upload from the phone, with audio. Always deleted
//   once analysis has finished.
// - metadata.trainingVideoPath: a video-only copy the ML server makes when
//   every player left training on. Kept only while that's still true: if a
//   player turns training off or deletes their account, the hourly sweep
//   deletes it.
//
// A failed analysis keeps the raw upload for FAILED_ANALYSIS_GRACE_DAYS so it
// can be re-run after a fix, then the sweep deletes it.

import { ballBoiSessionsTable, db } from "@workspace/db";
import { and, eq, isNotNull, lt, or, sql } from "drizzle-orm";
import { logger } from "./logger";
import { ObjectStorageService } from "./objectStorage";
import { matchIsTrainingEligible } from "./trainingEligibility";

export const TRAINING_PREFIX = "/objects/training/";
export const FAILED_ANALYSIS_GRACE_DAYS = 7;

type Session = typeof ballBoiSessionsTable.$inferSelect;

export interface RetentionDeps {
  isTrainingEligible(matchId: number): Promise<boolean>;
  deleteObject(objectPath: string): Promise<void>;
  saveSession(sessionId: number, changes: { videoObjectPath: string | null; metadata: Record<string, unknown> }): Promise<void>;
  now(): Date;
}

export interface RetentionPlan {
  keepTrainingCopy: string | null;
  remove: string[];
}

/** What to keep and what to delete. Pure, so the rules are easy to test. */
export function planRetention(
  rawVideoPath: string | null,
  trainingVideoPath: string | null,
  eligible: boolean,
): RetentionPlan {
  const remove: string[] = [];
  if (rawVideoPath) remove.push(rawVideoPath);
  let keepTrainingCopy: string | null = null;
  if (trainingVideoPath && trainingVideoPath !== rawVideoPath) {
    if (eligible && trainingVideoPath.startsWith(TRAINING_PREFIX)) keepTrainingCopy = trainingVideoPath;
    else remove.push(trainingVideoPath);
  }
  return { keepTrainingCopy, remove };
}

function metadataOf(session: Pick<Session, "metadata">): Record<string, unknown> {
  const m = session.metadata;
  return m != null && typeof m === "object" ? { ...(m as Record<string, unknown>) } : {};
}

let defaultStorage: ObjectStorageService | null = null;

const defaultDeps: RetentionDeps = {
  isTrainingEligible: (matchId) => matchIsTrainingEligible(matchId),
  deleteObject: (path) => {
    defaultStorage ??= new ObjectStorageService();
    return defaultStorage.deleteObject(path);
  },
  saveSession: async (sessionId, changes) => {
    await db.update(ballBoiSessionsTable).set(changes).where(eq(ballBoiSessionsTable.id, sessionId));
  },
  now: () => new Date(),
};

/**
 * Deletes what the rules say to delete. Call once analysis has finished.
 * `newTrainingCopy` is the ML server's trainingVideoKey, when it made one.
 * A delete that fails leaves its path in place, so the sweep tries again.
 */
export async function settleSessionVideo(
  session: Pick<Session, "id" | "matchId" | "videoObjectPath" | "metadata">,
  newTrainingCopy: string | null = null,
  deps: RetentionDeps = defaultDeps,
): Promise<void> {
  const metadata = metadataOf(session);
  const existingCopy = typeof metadata.trainingVideoPath === "string" ? metadata.trainingVideoPath : null;
  const candidate = newTrainingCopy ?? existingCopy;
  if (!session.videoObjectPath && !candidate) return;

  let eligible = false;
  try {
    eligible = await deps.isTrainingEligible(session.matchId);
  } catch (err) {
    logger.warn({ err, sessionId: session.id }, "Video retention: couldn't check training; treating as off");
  }
  const plan = planRetention(session.videoObjectPath, candidate, eligible);
  if (existingCopy && existingCopy !== candidate && !plan.remove.includes(existingCopy)) plan.remove.push(existingCopy);

  const failed = new Set<string>();
  for (const path of plan.remove) {
    try {
      await deps.deleteObject(path);
    } catch (err) {
      failed.add(path);
      logger.warn({ err, sessionId: session.id }, "Video retention: delete failed; the sweep will retry");
    }
  }

  const now = deps.now().toISOString();
  const rawGone = session.videoObjectPath != null && !failed.has(session.videoObjectPath);
  const trainingLeft = plan.keepTrainingCopy ?? (candidate && failed.has(candidate) ? candidate : null);
  const next: Record<string, unknown> = { ...metadata, trainingVideoPath: trainingLeft };
  if (rawGone) next.rawVideoDeletedAt = now;
  if (plan.keepTrainingCopy) next.keptForTrainingAt = metadata.keptForTrainingAt ?? now;
  else delete next.keptForTrainingAt;

  await deps.saveSession(session.id, {
    videoObjectPath: rawGone ? null : session.videoObjectPath,
    metadata: next,
  });
}

/** True only when every player left training on. Errors count as off. */
export async function keepForTraining(matchId: number): Promise<boolean> {
  try {
    return await matchIsTrainingEligible(matchId);
  } catch (err) {
    logger.warn({ err, matchId }, "Video retention: couldn't check training; treating as off");
    return false;
  }
}

/**
 * Hourly: finishes deletes that failed, drops training copies whose players
 * turned training off, and clears raw uploads from analyses that failed more
 * than FAILED_ANALYSIS_GRACE_DAYS ago.
 */
export async function sweepSessionVideos(deps: RetentionDeps = defaultDeps): Promise<number> {
  const cutoff = new Date(deps.now().getTime() - FAILED_ANALYSIS_GRACE_DAYS * 24 * 60 * 60 * 1000);
  const sessions = await db
    .select()
    .from(ballBoiSessionsTable)
    .where(
      or(
        and(
          eq(ballBoiSessionsTable.status, "completed"),
          or(isNotNull(ballBoiSessionsTable.videoObjectPath), sql`${ballBoiSessionsTable.metadata}->>'trainingVideoPath' is not null`),
        ),
        and(
          eq(ballBoiSessionsTable.status, "failed"),
          isNotNull(ballBoiSessionsTable.videoObjectPath),
          lt(ballBoiSessionsTable.updatedAt, cutoff),
        ),
      ),
    );
  for (const session of sessions) {
    try {
      await settleSessionVideo(session, null, deps);
    } catch (err) {
      logger.error({ err, sessionId: session.id }, "Video retention: sweep failed for a session");
    }
  }
  return sessions.length;
}
