import { describe, it, expect, vi } from "vitest";

vi.mock("../lib/logger", () => ({ logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() } }));
vi.mock("../lib/objectStorage", () => ({ ObjectStorageService: class {} }));
vi.mock("../lib/trainingEligibility", () => ({ matchIsTrainingEligible: vi.fn() }));
vi.mock("@workspace/db", () => ({ db: {}, ballBoiSessionsTable: {} }));

const { planRetention, settleSessionVideo } = await import("../lib/videoRetention.js");
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
