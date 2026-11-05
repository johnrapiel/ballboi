// Analysis that never hears back (Wave 1 review D11). The ML server posts its
// result once and never retries, so a lost callback, a crash or a restart
// left the card on "Analyzing" forever. Every 5 minutes this marks any
// analysis that has waited STUCK_ANALYSIS_MINUTES as failed, so within an
// hour the card says Ball Boi couldn't analyze the match. A result that
// still arrives later is saved as usual and the card turns to Replay is ready.

import { ballBoiSessionsTable, db } from "@workspace/db";
import { and, eq } from "drizzle-orm";
import { ANALYSIS_TIMEOUT_ERROR, isStuck } from "../lib/analysisFailure";
import { logger } from "../lib/logger";

export async function failStuckAnalyses(now: Date = new Date()): Promise<number> {
  const processing = await db
    .select({
      id: ballBoiSessionsTable.id,
      status: ballBoiSessionsTable.status,
      metadata: ballBoiSessionsTable.metadata,
      updatedAt: ballBoiSessionsTable.updatedAt,
    })
    .from(ballBoiSessionsTable)
    .where(eq(ballBoiSessionsTable.status, "processing"));
  let failed = 0;
  for (const session of processing) {
    if (!isStuck(session, now)) continue;
    try {
      await db
        .update(ballBoiSessionsTable)
        .set({ status: "failed", processingStatus: "failed", processingError: ANALYSIS_TIMEOUT_ERROR })
        // Only if it's still waiting: a result that came in meanwhile wins.
        .where(and(eq(ballBoiSessionsTable.id, session.id), eq(ballBoiSessionsTable.status, "processing")));
      failed++;
      logger.warn({ sessionId: session.id }, "Ball Boi analysis timed out with no result; marked failed");
    } catch (err) {
      logger.error({ err, sessionId: session.id }, "Couldn't mark a stuck analysis as failed");
    }
  }
  return failed;
}
