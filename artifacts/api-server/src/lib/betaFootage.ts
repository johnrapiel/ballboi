// Beta recordings for the labeled test set (spec decisions 89, 94, 95 and 99;
// B6, B11, B12, B16). John downloads them to his Mac with
// artifacts/ml-server/scripts/mac/download-beta.sh, which asks the admin-only
// GET /api/admin/beta-footage route for this list.
//
// A match can be used for testing when:
// - the recording is held for beta (metadata.heldForBeta, the video-only copy
//   in R2 kept until launch; see videoRetention.ts),
// - the person who recorded it agreed to the Beta Footage Release, and
// - nobody in it withdrew (metadata.withdrawnAt, set on every recording of a
//   match a player was in when they deleted their account).
// Placeholder opponents are fine for testing (B11). Training consent doesn't
// matter here: labeling isn't training.
//
// One file per match: when both players recorded, the earliest recording wins.
// Withdrawn matches are listed separately so the Mac script can say which
// downloaded file to delete.

// Same as videoRetention.ts (kept here so this file stays free of the database).
const TRAINING_PREFIX = "/objects/training/";

function isWithdrawn(metadata: Record<string, unknown>): boolean {
  return typeof metadata.withdrawnAt === "string";
}

export interface BetaFootageRow {
  sessionId: number;
  matchId: number;
  recordingStartedAt: Date;
  metadata: unknown;
  /** The release version the recorder agreed to; null if never (or no consent row). */
  releaseVersion: number | null;
}

export interface EligibleFootage {
  matchId: number;
  sessionId: number;
  recordedAt: Date;
  objectPath: string;
}

export interface BetaFootagePlan {
  eligible: EligibleFootage[];
  withdrawnMatchIds: number[];
}

function metadataOf(value: unknown): Record<string, unknown> {
  return value != null && typeof value === "object" ? (value as Record<string, unknown>) : {};
}

/** Pure, so the rules are easy to test. */
export function pickBetaFootage(rows: BetaFootageRow[]): BetaFootagePlan {
  const withdrawn = new Set<number>();
  for (const row of rows) if (isWithdrawn(metadataOf(row.metadata))) withdrawn.add(row.matchId);

  const byMatch = new Map<number, EligibleFootage>();
  for (const row of rows) {
    if (withdrawn.has(row.matchId)) continue;
    const m = metadataOf(row.metadata);
    if (m.heldForBeta !== true) continue;
    const path = m.trainingVideoPath;
    if (typeof path !== "string" || !path.startsWith(TRAINING_PREFIX)) continue;
    if (row.releaseVersion == null || row.releaseVersion < 1) continue;
    const candidate: EligibleFootage = {
      matchId: row.matchId,
      sessionId: row.sessionId,
      recordedAt: row.recordingStartedAt,
      objectPath: path,
    };
    const current = byMatch.get(row.matchId);
    if (
      !current ||
      candidate.recordedAt.getTime() < current.recordedAt.getTime() ||
      (candidate.recordedAt.getTime() === current.recordedAt.getTime() && candidate.sessionId < current.sessionId)
    ) {
      byMatch.set(row.matchId, candidate);
    }
  }

  const eligible = [...byMatch.values()].sort(
    (a, b) => a.recordedAt.getTime() - b.recordedAt.getTime() || a.matchId - b.matchId,
  );
  return { eligible, withdrawnMatchIds: [...withdrawn].sort((a, b) => a - b) };
}
