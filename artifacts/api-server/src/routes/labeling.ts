import { Router, type IRouter } from "express";
import { ballBoiSessionsTable, db, recordingConsentTable } from "@workspace/db";
import { eq, or, sql } from "drizzle-orm";
import { requireAdmin } from "../middlewares/requireAdmin";
import { pickBetaFootage, type BetaFootageRow } from "../lib/betaFootage";
import { ObjectNotFoundError, ObjectStorageService } from "../lib/objectStorage";
import { logger } from "../lib/logger";

// Beta recordings for the labeled test set (see lib/betaFootage.ts). Admin
// only. Read-only: it lists matches and signs short-lived download links; it
// never changes the database or R2. The video goes straight from R2 to John's
// Mac (B16); it's never played back in the app.

/** How long each download link works. Long enough to start a slow queue of big files. */
export const BETA_FOOTAGE_LINK_SECONDS = 2 * 60 * 60;

export interface BetaFootageDeps {
  listRows(): Promise<BetaFootageRow[]>;
  /** A presigned GET URL; throws ObjectNotFoundError when the copy isn't in R2. */
  signDownload(objectPath: string, ttlSec: number): Promise<string>;
  now(): Date;
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
        releaseVersion: recordingConsentTable.releaseVersion,
      })
      .from(ballBoiSessionsTable)
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
          matches.push({
            matchId: item.matchId,
            sessionId: item.sessionId,
            recordedAt: item.recordedAt.toISOString(),
            url,
            expiresAt,
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

  return router;
}

export default createLabelingRouter();
