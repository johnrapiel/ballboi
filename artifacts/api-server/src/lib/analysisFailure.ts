// What the Ball Boi tab says when analysis can't finish (Wave 1 review D11,
// John's decision Q16): "Ball Boi couldn't analyze this match", a short
// reason, and Remove. It never says Ball Boi keeps trying.
//
// The reason comes from the session's processingError, which is written by
// the API (no shots, service down, timed out) or by the ML server's pipeline
// (court not found, too short). Anything else gets a plain generic reason.

export type FailureKind = "court" | "short" | "timeout" | "unavailable" | "other";

export const FAILURE_REASONS: Record<FailureKind, string> = {
  court: "We couldn't see the court.",
  short: "The recording is too short.",
  timeout: "The analysis didn't finish.",
  unavailable: "Our analysis service was down.",
  other: "Something went wrong on our side.",
};

/**
 * The reason when the service "was down" only because no analysis server is
 * set up, as on the beta's staging API (John, Nov 10, decision 178). Real
 * outages keep "Our analysis service was down."
 */
export const NOT_IN_BETA_REASON = "Analysis isn't available in the beta yet.";

/** True when ML_SERVICE_URL names an analysis server. Unset or blank means none is set up. */
export function analysisServerConfigured(env: Record<string, string | undefined> = process.env): boolean {
  return (env.ML_SERVICE_URL ?? "").trim() !== "";
}

/** Written by the stuck-analysis sweep when the ML server never answered. */
export const ANALYSIS_TIMEOUT_ERROR = "Analysis timed out: the analysis service never sent a result.";

/** Waits between automatic retries while the ML service is down (services/ballBoiRetry.ts). */
export const RETRY_BACKOFF_MINUTES = [1, 5, 15] as const;
export const ANALYSIS_MAX_RETRIES = RETRY_BACKOFF_MINUTES.length;

/** Marker the API writes while the ML service is down and a retry is scheduled. */
export const ML_UNAVAILABLE_MARKER = "temporarily unavailable";

export function failureKind(processingError: string | null | undefined): FailureKind {
  const e = (processingError ?? "").toLowerCase();
  if (e.includes("without detected shots") || e.includes("find the court")) return "court";
  if (e.includes("too short")) return "short";
  if (e.startsWith("analysis timed out")) return "timeout";
  if (e.includes("unavailable") || e.includes("retry attempts have been exhausted")) return "unavailable";
  return "other";
}

/**
 * The short reason shown on the failed card. `serverConfigured` false: no
 * analysis server is set up, so "the service was down" says the beta has no
 * analysis yet instead.
 */
export function failureReason(processingError: string | null | undefined, serverConfigured = true): string {
  const kind = failureKind(processingError);
  if (kind === "unavailable" && !serverConfigured) return NOT_IN_BETA_REASON;
  return FAILURE_REASONS[kind];
}

/**
 * True while a failed session is waiting for an automatic retry (the ML
 * service was down and retries are left). The card shows Analyzing then,
 * not failed, since analysis really is still coming.
 */
export function retryPending(
  session: { status: string; processingError: string | null; metadata: unknown },
  maxRetries: number,
): boolean {
  if (session.status !== "failed") return false;
  if (!(session.processingError ?? "").toLowerCase().includes(ML_UNAVAILABLE_MARKER)) return false;
  const m = session.metadata && typeof session.metadata === "object" ? (session.metadata as Record<string, unknown>) : {};
  const count = typeof m.retryCount === "number" ? m.retryCount : 0;
  return count < maxRetries && typeof m.nextRetryAt === "string";
}

/** Analysis that has heard nothing back for this long is marked failed. With the 5-minute sweep, under an hour. */
export const STUCK_ANALYSIS_MINUTES = 50;

/** When analysis was sent off: metadata.analysisStartedAt, or the row's last update for older sessions. */
export function analysisStartedAt(session: { metadata: unknown; updatedAt: Date | string }): Date {
  const m = session.metadata && typeof session.metadata === "object" ? (session.metadata as Record<string, unknown>) : {};
  const started = typeof m.analysisStartedAt === "string" ? new Date(m.analysisStartedAt) : null;
  if (started && !Number.isNaN(started.getTime())) return started;
  return new Date(session.updatedAt);
}

/** True when a session in "processing" has waited too long for the ML server. */
export function isStuck(session: { status: string; metadata: unknown; updatedAt: Date | string }, now: Date): boolean {
  if (session.status !== "processing") return false;
  return now.getTime() - analysisStartedAt(session).getTime() >= STUCK_ANALYSIS_MINUTES * 60 * 1000;
}
