import { describe, expect, it, vi } from "vitest";

vi.mock("../lib/logger", () => ({ logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn() } }));
vi.mock("../lib/objectStorage", () => ({ ObjectStorageService: class {} }));
vi.mock("../lib/trainingEligibility", () => ({ matchIsTrainingEligible: vi.fn() }));
vi.mock("@workspace/db", () => ({ db: {}, ballBoiSessionsTable: {}, matchesTable: {} }));

const { withdrawFromRecordings, withdrawalEmail } = await import("../lib/withdrawal.js");

const log = { warn: vi.fn(), info: vi.fn() };
const at = new Date("2026-11-07T18:00:00Z");

function session(id: number, matchId: number) {
  return { id, matchId, recordingStartedAt: new Date("2026-11-03T15:00:00Z"), createdAt: new Date("2026-11-03T17:00:00Z"), metadata: {} };
}

describe("withdrawFromRecordings (B12)", () => {
  it("purges every recording of the player's matches and emails support the list", async () => {
    const purged: number[] = [];
    const send = vi.fn().mockResolvedValue({ sent: true });
    const result = await withdrawFromRecordings(
      { clerkUserId: "user_x", playerIds: [7], deletedSessions: [{ matchId: 3, sessionId: 30, recordedAt: null }] },
      log,
      {
        findSessions: async () => [session(10, 1), session(11, 2)] as never,
        markAndPurge: async (s, when) => {
          expect(when).toBe(at.toISOString());
          purged.push(s.id);
        },
        send,
        now: () => at,
      },
    );
    expect(purged).toEqual([10, 11]);
    expect(result).toEqual({ recordingsWithdrawn: 2, emailed: true });
    const email = send.mock.calls[0][0];
    expect(email.subject).toBe("Withdrawal: delete test-set copies for 3 matches");
    expect(email.text).toContain("- Match 1, recording 10, recorded 2026-11-03");
    expect(email.text).toContain("- Match 3, recording 30");
  });

  it("keeps going when one purge fails, and sends nothing when there were no recordings", async () => {
    const send = vi.fn().mockResolvedValue({ sent: true });
    await withdrawFromRecordings({ clerkUserId: "u", playerIds: [1], deletedSessions: [] }, log, {
      findSessions: async () => [session(1, 1), session(2, 2)] as never,
      markAndPurge: async (s) => {
        if (s.id === 1) throw new Error("R2 down");
      },
      send,
      now: () => at,
    });
    expect(send).toHaveBeenCalledTimes(1);
    send.mockClear();
    const none = await withdrawFromRecordings({ clerkUserId: "u", playerIds: [], deletedSessions: [] }, log, {
      findSessions: async () => [],
      markAndPurge: async () => {},
      send,
      now: () => at,
    });
    expect(none).toEqual({ recordingsWithdrawn: 0, emailed: false });
    expect(send).not.toHaveBeenCalled();
  });

  it("words one match as one match", () => {
    expect(withdrawalEmail("u", [{ matchId: 1, sessionId: 2, recordedAt: null }], at).subject).toBe(
      "Withdrawal: delete test-set copies for 1 match",
    );
  });
});
