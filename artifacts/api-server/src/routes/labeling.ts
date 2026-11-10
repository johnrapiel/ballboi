import { Router, type IRouter } from "express";
import { ballBoiSessionsTable, db, matchesTable, recordingConsentTable } from "@workspace/db";
import { eq, or, sql } from "drizzle-orm";
import { requireAdmin } from "../middlewares/requireAdmin";
import { pickBetaFootage, type BetaFootageRow } from "../lib/betaFootage";
import { ObjectNotFoundError, ObjectStorageService } from "../lib/objectStorage";
import { logger } from "../lib/logger";
import { audioDaysLeft } from "../lib/betaAudio";

// Beta recordings for the labeled test set (see lib/betaFootage.ts). Admin
// only. The list signs short-lived download links and never changes the
// database or R2. PUT .../test-set flags a match for the frozen test set
// (T2): its audio is then kept until launch instead of 30 days. The video goes straight from R2 to John's
// Mac (B16); it's never played back in the app.

/** How long each download link works. Long enough to start a slow queue of big files. */
export const BETA_FOOTAGE_LINK_SECONDS = 2 * 60 * 60;

export interface BetaFootageDeps {
  listRows(): Promise<BetaFootageRow[]>;
  /** A presigned GET URL; throws ObjectNotFoundError when the copy isn't in R2. */
  signDownload(objectPath: string, ttlSec: number): Promise<string>;
  now(): Date;
  /** Flags or unflags a match as test set. False when there's no such match. */
  setTestSet(matchId: number, on: boolean, at: Date): Promise<boolean>;
}

let storage: ObjectStorageService | null = null;

const defaultDeps: BetaFootageDeps = {
  async listRows() {
    const rows = await db
      .select({
        sessionId: ballBoiSessionsTable.id,
        matchId: ballBoiSessionsTable.matchId,
        recordingStartedAt: ballBoiSessionsTable.recordingStartedAt,
        metadata: ballBoiSessionsTable.metadata,
        videoObjectPath: ballBoiSessionsTable.videoObjectPath,
        testSetAt: matchesTable.ballBoiTestSetAt,
        releaseVersion: recordingConsentTable.releaseVersion,
      })
      .from(ballBoiSessionsTable)
      .leftJoin(matchesTable, eq(matchesTable.id, ballBoiSessionsTable.matchId))
      .leftJoin(recordingConsentTable, eq(recordingConsentTable.clerkUserId, ballBoiSessionsTable.recordedByClerkUserId))
      .where(
        or(
          sql`${ballBoiSessionsTable.metadata}->>'heldForBeta' = 'true'`,
          sql`${ballBoiSessionsTable.metadata}->>'withdrawnAt' is not null`,
        ),
      );
    return rows.map((r) => ({ ...r, releaseVersion: r.releaseVersion ?? null }));
  },
  signDownload(objectPath, ttlSec) {
    storage ??= new ObjectStorageService();
    return storage.getObjectEntityViewURL(objectPath, ttlSec);
  },
  now: () => new Date(),
  async setTestSet(matchId, on, at) {
    const rows = await db
      .update(matchesTable)
      .set({ ballBoiTestSetAt: on ? at : null })
      .where(eq(matchesTable.id, matchId))
      .returning({ id: matchesTable.id });
    return rows.length > 0;
  },
};

export function createLabelingRouter(deps: BetaFootageDeps = defaultDeps): IRouter {
  const router: IRouter = Router();

  router.get("/admin/beta-footage", requireAdmin, async (_req, res) => {
    try {
      const plan = pickBetaFootage(await deps.listRows());
      const expiresAt = new Date(deps.now().getTime() + BETA_FOOTAGE_LINK_SECONDS * 1000).toISOString();
      const matches = [];
      let missing = 0;
      for (const item of plan.eligible) {
        try {
          const url = await deps.signDownload(item.objectPath, BETA_FOOTAGE_LINK_SECONDS);
          // Test-set matches also get their audio (the raw upload, in pieces), for J and re-running the eval.
          const audioUrls: string[] = [];
          if (item.testSet) {
            for (const path of item.audioPaths) {
              try {
                audioUrls.push(await deps.signDownload(path, BETA_FOOTAGE_LINK_SECONDS));
              } catch (err) {
                if (!(err instanceof ObjectNotFoundError)) throw err;
              }
            }
          }
          matches.push({
            matchId: item.matchId,
            sessionId: item.sessionId,
            recordedAt: item.recordedAt.toISOString(),
            url,
            expiresAt,
            testSet: item.testSet,
            audioUrls,
            // Days left to pick it before its audio is deleted (T6). Null for test set or once the audio is gone.
            audioDaysLeft: item.testSet ? null : audioDaysLeft(item.audioHeldAt, deps.now()),
          });
        } catch (err) {
          if (err instanceof ObjectNotFoundError) {
            missing += 1;
            continue;
          }
          throw err;
        }
      }
      if (missing > 0) logger.warn({ missing }, "Beta footage: held copies missing from storage");
      res.json({ matches, withdrawnMatchIds: plan.withdrawnMatchIds, missingCount: missing });
    } catch (err) {
      logger.error({ err }, "Beta footage: couldn't list recordings");
      res.status(500).json({ error: "Couldn't list beta recordings" });
    }
  });

  /**
   * PUT /admin/beta-footage/:matchId/test-set { testSet: boolean }
   * John picks a match for the frozen test set (T1, T2): its audio is kept
   * until launch. Unflagging starts the normal 30-day rule again (counted
   * from upload, so audio older than that goes on the next hourly sweep).
   */
  router.put("/admin/beta-footage/:matchId/test-set", requireAdmin, async (req, res) => {
    const matchId = Number(req.params.matchId);
    const on = req.body?.testSet;
    if (!Number.isInteger(matchId) || matchId <= 0 || typeof on !== "boolean") {
      res.status(400).json({ error: "Send { testSet: true } or { testSet: false } for a match id." });
      return;
    }
    try {
      const found = await deps.setTestSet(matchId, on, deps.now());
      if (!found) {
        res.status(404).json({ error: "Match not found" });
        return;
      }
      logger.info({ matchId, testSet: on }, "Beta footage: test set changed");
      res.json({ matchId, testSet: on });
    } catch (err) {
      logger.error({ err, matchId }, "Beta footage: couldn't change the test set");
      res.status(500).json({ error: "Couldn't change the test set" });
    }
  });

  return router;
}

export default createLabelingRouter();
