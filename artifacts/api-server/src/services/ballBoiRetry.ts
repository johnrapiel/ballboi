import { db, ballBoiSessionsTable } from "@workspace/db";
import { eq, and, sql } from "drizzle-orm";
import { logger } from "../lib/logger";
import { courtCalibrationFromMetadata } from "../lib/ballBoiUtils";
import { isMlServiceUnreachable } from "../lib/mlServiceErrors";

const ML_SERVICE_URL = process.env.ML_SERVICE_URL ?? "http://localhost:8000";
const ML_SECRET = process.env.ML_SECRET;
const API_BASE_URL = process.env.API_BASE_URL ?? `http://localhost:${process.env.PORT ?? 8080}`;

export const ML_UNAVAILABLE_MARKER = "temporarily unavailable";

const RETRY_BACKOFF_MINUTES = [1, 5, 15] as const;
export const MAX_RETRIES = RETRY_BACKOFF_MINUTES.length;

export function computeNextRetryAt(retryCount: number): Date {
  const delayMinutes = RETRY_BACKOFF_MINUTES[retryCount] ?? RETRY_BACKOFF_MINUTES[RETRY_BACKOFF_MINUTES.length - 1];
  return new Date(Date.now() + delayMinutes * 60 * 1000);
}

export async function retryFailedBallBoiSessions(): Promise<void> {
  let sessions: (typeof ballBoiSessionsTable.$inferSelect)[];
  try {
    sessions = await db
      .select()
      .from(ballBoiSessionsTable)
      .where(
        and(
          eq(ballBoiSessionsTable.status, "failed"),
          sql`${ballBoiSessionsTable.processingError} ilike ${"%" + ML_UNAVAILABLE_MARKER + "%"}`,
          sql`(${ballBoiSessionsTable.metadata}->>'retryCount')::int < ${MAX_RETRIES}`,
          sql`(${ballBoiSessionsTable.metadata}->>'nextRetryAt') is not null`,
          sql`(${ballBoiSessionsTable.metadata}->>'nextRetryAt')::timestamptz <= now()`
        )
      );
  } catch (err) {
    logger.error({ err }, "BallBoi retry: failed to query retryable sessions");
    return;
  }

  if (sessions.length === 0) return;

  logger.info({ count: sessions.length }, "BallBoi retry: found sessions to retry");

  for (const session of sessions) {
    const metadata = (session.metadata as Record<string, unknown>) ?? {};
    const retryCount = typeof metadata.retryCount === "number" ? metadata.retryCount : 0;

    if (retryCount >= MAX_RETRIES) continue;

    const nextRetryAtRaw = typeof metadata.nextRetryAt === "string" ? metadata.nextRetryAt : null;
    if (!nextRetryAtRaw || new Date(nextRetryAtRaw) > new Date()) {
      logger.warn({ sessionId: session.id }, "BallBoi retry: nextRetryAt is missing or in the future, skipping");
      continue;
    }

    const mlCallbackToken =
      typeof metadata.mlCallbackToken === "string" ? metadata.mlCallbackToken : null;
    if (!session.videoObjectPath || !mlCallbackToken) {
      logger.warn({ sessionId: session.id }, "BallBoi retry: session missing video path or callback token, skipping");
      continue;
    }

    const videoUrl = `${API_BASE_URL}/api/storage${session.videoObjectPath}`;
    const callbackUrl = `${API_BASE_URL}/api/ball-boi/sessions/${session.id}/ml-callback?token=${encodeURIComponent(mlCallbackToken)}`;

    logger.info({ sessionId: session.id, retryCount, attempt: retryCount + 1 }, "BallBoi retry: dispatching to ML service");

    try {
      await db
        .update(ballBoiSessionsTable)
        .set({
          status: "processing",
          processingStatus: "processing",
          processingError: null,
          metadata: { ...metadata, retryCount, nextRetryAt: null },
        })
        .where(eq(ballBoiSessionsTable.id, session.id));

      const mlRes = await fetch(`${ML_SERVICE_URL}/analyze-match-batch`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          ...(ML_SECRET ? { "X-ML-Secret": ML_SECRET } : {}),
        },
        body: JSON.stringify({
          video_url: videoUrl,
          session_id: session.id,
          match_id: session.matchId,
          callback_url: callbackUrl,
          court_calibration: courtCalibrationFromMetadata(session.metadata),
        }),
        signal: AbortSignal.timeout(5000),
      });

      if (!mlRes.ok) throw new Error(`ML service returned ${mlRes.status}`);

      logger.info({ sessionId: session.id, attempt: retryCount + 1 }, "BallBoi retry: successfully dispatched to ML service");
    } catch (mlErr) {
      const nextRetryCount = retryCount + 1;
      const isUnreachable = isMlServiceUnreachable(mlErr);
      logger.warn({ mlErr, sessionId: session.id, nextRetryCount, isUnreachable }, "BallBoi retry: ML dispatch failed");

      if (nextRetryCount >= MAX_RETRIES) {
        await db
          .update(ballBoiSessionsTable)
          .set({
            status: "failed",
            processingStatus: "failed",
            processingError:
              "Analysis service is unavailable. Automatic retry attempts have been exhausted — please try again later.",
            metadata: { ...metadata, retryCount: nextRetryCount, nextRetryAt: null },
          })
          .where(eq(ballBoiSessionsTable.id, session.id));
        logger.info({ sessionId: session.id }, "BallBoi retry: max retries exhausted, session permanently failed");
      } else {
        const nextRetryAt = computeNextRetryAt(nextRetryCount);
        await db
          .update(ballBoiSessionsTable)
          .set({
            status: "failed",
            processingStatus: "failed",
            processingError:
              "Analysis service is temporarily unavailable — your video has been saved and results will appear once the service is back online.",
            metadata: { ...metadata, retryCount: nextRetryCount, nextRetryAt: nextRetryAt.toISOString() },
          })
          .where(eq(ballBoiSessionsTable.id, session.id));
        logger.info({ sessionId: session.id, nextRetryAt }, "BallBoi retry: scheduled next retry");
      }
    }
  }
}
