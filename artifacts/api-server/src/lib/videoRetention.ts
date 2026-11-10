// Spec (Video and training data): "Raw video deleted after analysis, unless the
// match is kept for training" and "Audio: ... deleted after processing."
//
// A session can hold two videos:
// - videoObjectPath: the raw upload from the phone, with audio. Always deleted
//   once analysis has finished. A match recorded in pieces (a call
//   interrupted it) has the rest in metadata.segmentPaths; they go too.
// - metadata.trainingVideoPath: a video-only copy the ML server makes when
//   every player left training on. Kept only while that's still true: if a
//   player turns training off or deletes their account, the hourly sweep
//   deletes it.
//
// A failed analysis keeps the raw upload for FAILED_ANALYSIS_GRACE_DAYS so it
// can be re-run after a fix, then the sweep deletes it.
//
// Beta (spec decision 89, B6): while BETA_RELEASE_REQUIRED is on, beta footage
// is kept until launch. The ML server makes the video-only copy for every
// match, and it's kept even when not every player left training on
// (metadata.heldForBeta). The raw upload, the only copy with audio, is still
// deleted after analysis. Once the setting is off at launch, the hourly sweep
// applies the normal rule again and deletes held copies that aren't eligible.
// A held copy is for the labeled test set; it's only ever trained on when
// matchIsTrainingEligible() says so.
//
// Beta audio (shot tracker test plan, T2 and T6): while BETA_RELEASE_REQUIRED
// is on, the raw upload (and its pieces), the only copy with audio, is held
// for a 30-day pick window from upload (metadata.audioHeldAt) instead of
// being deleted after analysis. It stays where it is (videoObjectPath and
// segmentPaths), so it stays protected like any Ball Boi video. If John flags
// the match as test set (matches.ball_boi_test_set_at, from the admin
// beta-footage route), it's kept until launch. Otherwise the hourly sweep
// deletes it after 30 days and logs each deletion. Once the setting is off at
// launch, the sweep deletes all held audio, test set included, and the
// normal rule applies: audio deleted after processing.
//
// Withdrawal (spec decision 95, B12): when a player deletes their account,
// every session in a match they played gets metadata.withdrawnAt. Its videos
// are deleted at once, raw and copy, beta or not, and the sweep retries any
// delete that failed, well within the 30 days the release promises.

import { ballBoiSessionsTable, db, matchesTable } from "@workspace/db";
import { and, eq, isNotNull, lt, or, sql } from "drizzle-orm";
import { logger } from "./logger";
import { ObjectStorageService } from "./objectStorage";
import { matchIsTrainingEligible } from "./trainingEligibility";
import { segmentPathsOf } from "./mlDispatch";
import { readBetaRelease } from "./betaRelease";
import { audioDecision, type AudioDecision } from "./betaAudio";

export const TRAINING_PREFIX = "/objects/training/";
export const FAILED_ANALYSIS_GRACE_DAYS = 7;
export { AUDIO_PICK_DAYS, audioDaysLeft, audioDecision, type AudioDecision } from "./betaAudio";

type Session = typeof ballBoiSessionsTable.$inferSelect;

export interface RetentionDeps {
  isTrainingEligible(matchId: number): Promise<boolean>;
  deleteObject(objectPath: string): Promise<void>;
  saveSession(sessionId: number, changes: { videoObjectPath: string | null; metadata: Record<string, unknown> }): Promise<void>;
  now(): Date;
  /** Beta footage is kept until launch (B6). Defaults to off when left out. */
  betaHold?(): boolean;
  /** John picked this match for the test set (T2). Defaults to no when left out. */
  isTestSet?(matchId: number): Promise<boolean>;
  /** The audio pick window, in days (tests shorten it). */
  audioPickDays?: number;
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
  otherRawPaths: string[] = [],
): RetentionPlan {
  const remove: string[] = [];
  if (rawVideoPath) remove.push(rawVideoPath);
  for (const p of otherRawPaths) if (p !== rawVideoPath && p !== trainingVideoPath && !remove.includes(p)) remove.push(p);
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
  betaHold: () => readBetaRelease().required,
  isTestSet: async (matchId) => {
    const [row] = await db
      .select({ at: matchesTable.ballBoiTestSetAt })
      .from(matchesTable)
      .where(eq(matchesTable.id, matchId));
    return !!row?.at;
  },
};

/** A player in this match withdrew (deleted their account): its video goes, beta or not. */
export function isWithdrawn(metadata: Record<string, unknown>): boolean {
  return typeof metadata.withdrawnAt === "string";
}

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
  const otherRaw = segmentPathsOf(metadata);
  if (!session.videoObjectPath && !candidate && otherRaw.length === 0) return;

  const withdrawn = isWithdrawn(metadata);
  let eligible = false;
  if (!withdrawn) {
    try {
      eligible = await deps.isTrainingEligible(session.matchId);
    } catch (err) {
      logger.warn({ err, sessionId: session.id }, "Video retention: couldn't check training; treating as off");
    }
  }
  const beta = !withdrawn && !!deps.betaHold?.();
  const held = beta && !eligible;

  // The raw upload holds the audio: during the beta it waits out the pick window (T6).
  const hasRaw = !!session.videoObjectPath || otherRaw.length > 0;
  const heldAt = typeof metadata.audioHeldAt === "string" ? metadata.audioHeldAt : null;
  let audio: AudioDecision = { hold: false, reason: "notBeta" };
  if (hasRaw) {
    let testSet = false;
    if (beta) {
      try {
        testSet = !!(await deps.isTestSet?.(session.matchId));
      } catch (err) {
        // Not sure: keep it this hour, and check again on the next sweep.
        logger.warn({ err, sessionId: session.id }, "Beta audio: couldn't check the test set; keeping the audio for now");
        testSet = true;
      }
    }
    audio = audioDecision({ beta, withdrawn, testSet, heldAt, now: deps.now(), days: deps.audioPickDays });
  }
  const holdAudio = audio.hold;
  const plan = planRetention(holdAudio ? null : session.videoObjectPath, candidate, eligible || held, holdAudio ? [] : otherRaw);
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
  const rawGone = !holdAudio && session.videoObjectPath != null && !failed.has(session.videoObjectPath);
  const trainingLeft = plan.keepTrainingCopy ?? (candidate && failed.has(candidate) ? candidate : null);
  const next: Record<string, unknown> = { ...metadata, trainingVideoPath: trainingLeft };
  const otherLeft = holdAudio ? otherRaw : otherRaw.filter((p) => failed.has(p));
  if (otherLeft.length > 0) next.segmentPaths = otherLeft;
  else delete next.segmentPaths;
  if (rawGone && otherLeft.length === 0) next.rawVideoDeletedAt = now;
  if (holdAudio) {
    // The window runs from upload (analysis started once the upload finished).
    next.audioHeldAt = heldAt ?? (typeof metadata.analysisStartedAt === "string" ? metadata.analysisStartedAt : now);
  } else if (heldAt || audio.reason === "withdrawn") {
    const rawPaths = [session.videoObjectPath, ...otherRaw].filter((p): p is string => !!p);
    for (const path of rawPaths) {
      if (failed.has(path)) continue;
      // Each deletion is logged (T6), with why: the 30 days ran out, launch, or a withdrawal.
      logger.info({ sessionId: session.id, matchId: session.matchId, path, reason: audio.reason, heldAt }, "Beta audio deleted");
    }
    const allGone = rawPaths.every((p) => !failed.has(p));
    if (allGone) {
      delete next.audioHeldAt;
      if (heldAt) next.audioDeletedAt = now;
    }
  }
  if (plan.keepTrainingCopy && !held) next.keptForTrainingAt = metadata.keptForTrainingAt ?? now;
  else delete next.keptForTrainingAt;
  if (plan.keepTrainingCopy && held) next.heldForBeta = true;
  else delete next.heldForBeta;

  await deps.saveSession(session.id, {
    videoObjectPath: rawGone ? null : session.videoObjectPath,
    metadata: next,
  });
}

/**
 * Whether the ML server should make the video-only copy: when every player
 * left training on, and for every match while beta footage is kept (B6).
 * Errors count as off.
 */
export async function keepForTraining(matchId: number): Promise<boolean> {
  if (readBetaRelease().required) return true;
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
          or(
            isNotNull(ballBoiSessionsTable.videoObjectPath),
            sql`${ballBoiSessionsTable.metadata}->>'trainingVideoPath' is not null`,
            sql`${ballBoiSessionsTable.metadata}->>'segmentPaths' is not null`,
          ),
        ),
        and(
          sql`${ballBoiSessionsTable.metadata}->>'withdrawnAt' is not null`,
          or(
            isNotNull(ballBoiSessionsTable.videoObjectPath),
            sql`${ballBoiSessionsTable.metadata}->>'trainingVideoPath' is not null`,
            sql`${ballBoiSessionsTable.metadata}->>'segmentPaths' is not null`,
          ),
        ),
        // Beta audio waiting out its pick window, whatever the analysis did.
        sql`${ballBoiSessionsTable.metadata}->>'audioHeldAt' is not null`,
        and(
          eq(ballBoiSessionsTable.status, "failed"),
          or(isNotNull(ballBoiSessionsTable.videoObjectPath), sql`${ballBoiSessionsTable.metadata}->>'segmentPaths' is not null`),
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
