import { describe, it, expect, vi } from "vitest";

vi.mock("../lib/logger", () => ({ logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() } }));
vi.mock("../lib/objectStorage", () => ({ ObjectStorageService: class {} }));
vi.mock("../lib/trainingEligibility", () => ({ matchIsTrainingEligible: vi.fn() }));
vi.mock("@workspace/db", () => ({ db: {}, ballBoiSessionsTable: {}, matchesTable: {} }));

const { audioDaysLeft, audioDecision, planRetention, settleSessionVideo } = await import("../lib/videoRetention.js");
import type { RetentionDeps } from "../lib/videoRetention.js";

const RAW = "/objects/uploads/raw-1";
const COPY = "/objects/training/session-1.mp4";

function deps(eligible: boolean, failing: string[] = []) {
  const deleted: string[] = [];
  const saved: Array<{ videoObjectPath: string | null; metadata: Record<string, unknown> }> = [];
  const d: RetentionDeps = {
    isTrainingEligible: async () => eligible,
    deleteObject: async (path) => {
      if (failing.includes(path)) throw new Error("R2 down");
      deleted.push(path);
    },
    saveSession: async (_id, changes) => {
      saved.push(changes);
    },
    now: () => new Date("2026-11-01T12:00:00Z"),
  };
  return { d, deleted, saved };
}

describe("planRetention", () => {
  it("always deletes the raw upload, which is the only copy with audio", () => {
    expect(planRetention(RAW, null, true)).toEqual({ keepTrainingCopy: null, remove: [RAW] });
  });

  it("keeps the video-only copy only when every player left training on", () => {
    expect(planRetention(RAW, COPY, true)).toEqual({ keepTrainingCopy: COPY, remove: [RAW] });
    expect(planRetention(RAW, COPY, false)).toEqual({ keepTrainingCopy: null, remove: [RAW, COPY] });
  });

  it("never keeps something outside the training folder, even when eligible", () => {
    expect(planRetention(null, "/objects/uploads/other", true).keepTrainingCopy).toBeNull();
  });
});

describe("settleSessionVideo", () => {
  const session = { id: 1, matchId: 10, videoObjectPath: RAW, metadata: { mlCallbackToken: "t" } };

  it("non-training match: both files deleted, session no longer points at video", async () => {
    const { d, deleted, saved } = deps(false);
    await settleSessionVideo(session, COPY, d);
    expect(deleted).toEqual([RAW, COPY]);
    expect(saved[0].videoObjectPath).toBeNull();
    expect(saved[0].metadata).toMatchObject({ mlCallbackToken: "t", trainingVideoPath: null, rawVideoDeletedAt: "2026-11-01T12:00:00.000Z" });
  });

  it("training match: raw deleted, video-only copy kept", async () => {
    const { d, deleted, saved } = deps(true);
    await settleSessionVideo(session, COPY, d);
    expect(deleted).toEqual([RAW]);
    expect(saved[0].metadata).toMatchObject({ trainingVideoPath: COPY, keptForTrainingAt: "2026-11-01T12:00:00.000Z" });
  });

  it("a player turning training off later: the sweep deletes the kept copy", async () => {
    const kept = { id: 1, matchId: 10, videoObjectPath: null, metadata: { trainingVideoPath: COPY, keptForTrainingAt: "x" } };
    const { d, deleted, saved } = deps(false);
    await settleSessionVideo(kept, null, d);
    expect(deleted).toEqual([COPY]);
    expect(saved[0].metadata.trainingVideoPath).toBeNull();
    expect(saved[0].metadata).not.toHaveProperty("keptForTrainingAt");
  });

  it("a kept copy that's still eligible is left alone", async () => {
    const kept = { id: 1, matchId: 10, videoObjectPath: null, metadata: { trainingVideoPath: COPY } };
    const { d, deleted } = deps(true);
    await settleSessionVideo(kept, null, d);
    expect(deleted).toEqual([]);
  });

  it("a failed delete keeps the path so the next sweep retries it", async () => {
    const { d, saved } = deps(false, [RAW]);
    await settleSessionVideo(session, null, d);
    expect(saved[0].videoObjectPath).toBe(RAW);
    expect(saved[0].metadata).not.toHaveProperty("rawVideoDeletedAt");
  });

  it("if the training check errors, it counts as off and nothing is kept", async () => {
    const { d, deleted } = deps(true);
    d.isTrainingEligible = async () => { throw new Error("db down"); };
    await settleSessionVideo(session, COPY, d);
    expect(deleted).toEqual([RAW, COPY]);
  });

  it("does nothing when there's no video left", async () => {
    const { d, saved } = deps(true);
    await settleSessionVideo({ id: 1, matchId: 10, videoObjectPath: null, metadata: {} }, null, d);
    expect(saved).toEqual([]);
  });
});

describe("beta footage (B6) and withdrawal (B12)", () => {
  it("holds the video-only copy until launch, and the raw upload (the audio) for the pick window", async () => {
    const { d, deleted, saved } = deps(false);
    await settleSessionVideo(
      { id: 1, matchId: 1, videoObjectPath: RAW, metadata: { analysisStartedAt: "2026-10-31T09:00:00.000Z" } },
      COPY,
      { ...d, betaHold: () => true },
    );
    expect(deleted).toEqual([]);
    expect(saved[0].videoObjectPath).toBe(RAW);
    expect(saved[0].metadata).toMatchObject({ trainingVideoPath: COPY, heldForBeta: true, audioHeldAt: "2026-10-31T09:00:00.000Z" });
    expect(saved[0].metadata).not.toHaveProperty("keptForTrainingAt");
    expect(saved[0].metadata).not.toHaveProperty("rawVideoDeletedAt");
  });

  it("applies the normal rule again once the beta is over", async () => {
    const { d, deleted, saved } = deps(false);
    await settleSessionVideo(
      { id: 1, matchId: 1, videoObjectPath: null, metadata: { trainingVideoPath: COPY, heldForBeta: true } },
      null,
      { ...d, betaHold: () => false },
    );
    expect(deleted).toEqual([COPY]);
    expect(saved[0].metadata).not.toHaveProperty("heldForBeta");
  });

  it("deletes everything from a withdrawn match, beta or training", async () => {
    const { d, deleted, saved } = deps(true);
    await settleSessionVideo(
      {
        id: 1,
        matchId: 1,
        videoObjectPath: RAW,
        metadata: { trainingVideoPath: COPY, withdrawnAt: "2026-11-07T00:00:00Z", segmentPaths: [RAW, "/objects/uploads/raw-1-1"] },
      },
      null,
      { ...d, betaHold: () => true },
    );
    expect(deleted.sort()).toEqual([COPY, RAW, "/objects/uploads/raw-1-1"].sort());
    expect(saved[0].videoObjectPath).toBeNull();
    expect(saved[0].metadata.trainingVideoPath).toBeNull();
  });
});

describe("beta audio pick window (T2, T6)", () => {
  const HELD = "2026-10-01T12:00:00.000Z"; // 31 days before deps' now
  const RECENT = "2026-10-20T12:00:00.000Z"; // 12 days before
  const PIECE = "/objects/uploads/raw-1-1";
  const heldSession = (heldAt: string) => ({
    id: 1,
    matchId: 10,
    videoObjectPath: RAW,
    metadata: { trainingVideoPath: COPY, heldForBeta: true, audioHeldAt: heldAt, segmentPaths: [PIECE] },
  });

  it("decides hold or delete", () => {
    const now = new Date("2026-11-01T12:00:00Z");
    expect(audioDecision({ beta: true, withdrawn: false, testSet: false, heldAt: RECENT, now })).toEqual({ hold: true });
    expect(audioDecision({ beta: true, withdrawn: false, testSet: false, heldAt: HELD, now })).toEqual({ hold: false, reason: "window" });
    expect(audioDecision({ beta: true, withdrawn: false, testSet: true, heldAt: HELD, now })).toEqual({ hold: true });
    expect(audioDecision({ beta: false, withdrawn: false, testSet: true, heldAt: HELD, now })).toEqual({ hold: false, reason: "launch" });
    expect(audioDecision({ beta: false, withdrawn: false, testSet: false, heldAt: null, now })).toEqual({ hold: false, reason: "notBeta" });
    expect(audioDecision({ beta: true, withdrawn: true, testSet: true, heldAt: RECENT, now })).toEqual({ hold: false, reason: "withdrawn" });
    expect(audioDecision({ beta: true, withdrawn: false, testSet: false, heldAt: RECENT, now, days: 5 })).toEqual({ hold: false, reason: "window" });
  });

  it("counts the days left in the window", () => {
    const now = new Date("2026-11-01T12:00:00Z");
    expect(audioDaysLeft(RECENT, now)).toBe(18);
    expect(audioDaysLeft(HELD, now)).toBe(0);
    expect(audioDaysLeft(undefined, now)).toBeNull();
  });

  it("inside the window: audio kept, video copy held", async () => {
    const { d, deleted, saved } = deps(false);
    await settleSessionVideo(heldSession(RECENT), null, { ...d, betaHold: () => true, isTestSet: async () => false });
    expect(deleted).toEqual([]);
    expect(saved[0].videoObjectPath).toBe(RAW);
    expect(saved[0].metadata).toMatchObject({ audioHeldAt: RECENT, segmentPaths: [PIECE], trainingVideoPath: COPY });
  });

  it("not flagged after 30 days: audio deleted and logged, video copy still held", async () => {
    const { logger } = await import("../lib/logger");
    const info = vi.mocked(logger.info);
    info.mockClear();
    const { d, deleted, saved } = deps(false);
    await settleSessionVideo(heldSession(HELD), null, { ...d, betaHold: () => true, isTestSet: async () => false });
    expect(deleted.sort()).toEqual([RAW, PIECE].sort());
    expect(saved[0].videoObjectPath).toBeNull();
    expect(saved[0].metadata).toMatchObject({ trainingVideoPath: COPY, heldForBeta: true, audioDeletedAt: "2026-11-01T12:00:00.000Z" });
    expect(saved[0].metadata).not.toHaveProperty("audioHeldAt");
    expect(saved[0].metadata).not.toHaveProperty("segmentPaths");
    const logged = info.mock.calls.filter((c) => c[1] === "Beta audio deleted");
    expect(logged.map((c) => (c[0] as { path: string; reason: string }).path).sort()).toEqual([RAW, PIECE].sort());
    expect((logged[0][0] as { reason: string }).reason).toBe("window");
  });

  it("flagged test set: audio kept past 30 days (window shortened to 1 day here)", async () => {
    const { d, deleted, saved } = deps(false);
    await settleSessionVideo(heldSession(RECENT), null, { ...d, betaHold: () => true, isTestSet: async () => true, audioPickDays: 1 });
    expect(deleted).toEqual([]);
    expect(saved[0].videoObjectPath).toBe(RAW);
  });

  it("a test-set check that fails keeps the audio until the next sweep", async () => {
    const { d, deleted } = deps(false);
    await settleSessionVideo(heldSession(HELD), null, {
      ...d,
      betaHold: () => true,
      isTestSet: async () => {
        throw new Error("db down");
      },
    });
    expect(deleted).toEqual([]);
  });

  it("at launch (beta off): held audio goes, test set included", async () => {
    const { d, deleted, saved } = deps(false);
    await settleSessionVideo(heldSession(RECENT), null, { ...d, betaHold: () => false, isTestSet: async () => true });
    expect(deleted).toContain(RAW);
    expect(deleted).toContain(PIECE);
    expect(saved[0].metadata).toMatchObject({ audioDeletedAt: "2026-11-01T12:00:00.000Z" });
  });

  it("beta off from the start: audio deleted after processing as before", async () => {
    const { d, deleted, saved } = deps(false);
    await settleSessionVideo({ id: 1, matchId: 10, videoObjectPath: RAW, metadata: {} }, null, { ...d, betaHold: () => false });
    expect(deleted).toEqual([RAW]);
    expect(saved[0].metadata).not.toHaveProperty("audioHeldAt");
    expect(saved[0].metadata).toHaveProperty("rawVideoDeletedAt");
  });

  it("withdrawal deletes held audio of a test-set match too", async () => {
    const { d, deleted, saved } = deps(false);
    const s = heldSession(RECENT);
    await settleSessionVideo({ ...s, metadata: { ...s.metadata, withdrawnAt: "2026-11-01T00:00:00Z" } }, null, {
      ...d,
      betaHold: () => true,
      isTestSet: async () => true,
    });
    expect(deleted.sort()).toEqual([COPY, PIECE, RAW].sort());
    expect(saved[0].videoObjectPath).toBeNull();
  });

  it("a failed audio delete stays held so the sweep retries", async () => {
    const { d, saved } = deps(false, [RAW]);
    await settleSessionVideo(heldSession(HELD), null, { ...d, betaHold: () => true, isTestSet: async () => false });
    expect(saved[0].videoObjectPath).toBe(RAW);
    expect(saved[0].metadata).toHaveProperty("audioHeldAt");
  });
});
