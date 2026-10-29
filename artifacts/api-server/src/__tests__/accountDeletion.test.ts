import { describe, it, expect, vi, beforeEach } from "vitest";
import express from "express";
import supertest from "supertest";

// ─── Shared mocks ────────────────────────────────────────────────────────────

let mockUserId: string | null = "user_delete_me";

vi.mock("@clerk/express", () => ({
  getAuth: () => ({ userId: mockUserId }),
  clerkMiddleware: () => (_req: unknown, _res: unknown, next: () => void) => next(),
  clerkClient: { users: { deleteUser: vi.fn() } },
}));

vi.mock("../lib/autoLinkPlayer.js", () => ({ autoLinkPlayersForUser: vi.fn().mockResolvedValue(undefined) }));

// A fake transaction that records what was deleted and updated.
type Call = { op: string; table: string; values?: unknown };
const calls: Call[] = [];
const selectResults: Record<string, unknown[]> = {};
// Optional results for a table's second select (players: first "mine", then "opponents").
const secondSelectResults: Record<string, unknown[]> = {};
const selectCounts: Record<string, number> = {};
let legacyTableExists = false;
let legacyRows: { video_object_path: string | null }[] = [];

function table(name: string, cols: string[]) {
  const t: Record<string, unknown> = { __name: name };
  for (const c of cols) t[c] = { table: name, col: c };
  return t;
}

const tables = {
  ballBoiSessionsTable: table("ball_boi_sessions", ["id", "matchId", "videoObjectPath", "recordedByClerkUserId"]),
  matchesTable: table("matches", ["id", "player1Id", "player2Id"]),
  playersTable: table("players", ["id", "clerkUserId", "name", "email", "phone", "bio"]),
  playerAvailabilityTable: table("player_availability", ["playerId"]),
  playerLocationsTable: table("player_locations", ["playerId"]),
  pushSubscriptionsTable: table("push_subscriptions", ["userId"]),
  expoPushTokensTable: table("expo_push_tokens", ["userId"]),
  usersTable: table("users", ["clerkUserId"]),
  ratingHistoryTable: table("rating_history", ["clerkUserId"]),
  userBlocksTable: table("user_blocks", ["blockerClerkUserId", "blockedClerkUserId"]),
  contentReportsTable: table("content_reports", ["reporterClerkUserId"]),
};

const tx = {
  select: () => ({
    from: (t: { __name: string }) => ({
      where: async () => {
        const n = (selectCounts[t.__name] = (selectCounts[t.__name] ?? 0) + 1);
        if (n > 1 && secondSelectResults[t.__name]) return secondSelectResults[t.__name];
        return selectResults[t.__name] ?? [];
      },
    }),
  }),
  delete: (t: { __name: string }) => ({
    where: async () => {
      calls.push({ op: "delete", table: t.__name });
    },
  }),
  update: (t: { __name: string }) => ({
    set: (values: unknown) => ({
      where: async () => {
        calls.push({ op: "update", table: t.__name, values });
      },
    }),
  }),
  execute: async (q: { text: string }) => {
    if (q.text.includes("to_regclass")) return { rows: [{ t: legacyTableExists ? "shot_recordings" : null }] };
    if (q.text.includes("DELETE FROM shot_recordings")) {
      calls.push({ op: "delete", table: "shot_recordings" });
      return { rows: legacyRows };
    }
    return { rows: [] };
  },
};

vi.mock("@workspace/db", () => ({
  db: {
    transaction: async (fn: (t: typeof tx) => unknown) => fn(tx),
    select: vi.fn(),
  },
  ...tables,
}));

vi.mock("drizzle-orm", () => ({
  eq: (a: unknown, b: unknown) => ({ a, b }),
  inArray: (a: unknown, b: unknown) => ({ a, b }),
  or: (...args: unknown[]) => args,
  sql: (strings: TemplateStringsArray) => ({ text: strings.join("?") }),
}));

const log = { warn: vi.fn(), info: vi.fn() };

beforeEach(() => {
  calls.length = 0;
  for (const k of Object.keys(selectResults)) delete selectResults[k];
  for (const k of Object.keys(secondSelectResults)) delete secondSelectResults[k];
  for (const k of Object.keys(selectCounts)) delete selectCounts[k];
  legacyTableExists = false;
  legacyRows = [];
  mockUserId = "user_delete_me";
  vi.clearAllMocks();
});

// ─── deleteAccount ───────────────────────────────────────────────────────────

describe("deleteAccount", () => {
  it("deletes personal data, anonymizes league players, removes videos, then deletes the Clerk user", async () => {
    const { deleteAccount, DELETED_PLAYER_NAME, DELETED_RECORDER_ID } = await import("../lib/accountDeletion.js");
    // 7 and 9 are mine. Opponent 20 has an account; 21 has no linked account.
    selectResults.players = [{ id: 7 }, { id: 9 }];
    secondSelectResults.players = [
      { id: 20, clerkUserId: "user_opponent" },
      { id: 21, clerkUserId: null },
    ];
    selectResults.ball_boi_sessions = [
      { id: 1, matchId: 100, videoObjectPath: "/objects/uploads/a" },
      { id: 2, matchId: 101, videoObjectPath: null },
    ];
    selectResults.matches = [
      { id: 100, player1Id: 7, player2Id: 20 },
      { id: 101, player1Id: 21, player2Id: 9 },
    ];
    legacyTableExists = true;
    legacyRows = [{ video_object_path: "/objects/uploads/b" }, { video_object_path: "/objects/uploads/a" }];

    const storage = { deleteObject: vi.fn().mockResolvedValue(undefined) };
    const order: string[] = [];
    storage.deleteObject.mockImplementation(async (p: string) => void order.push(`video:${p}`));
    const deleteClerkUser = vi.fn(async () => void order.push("clerk"));

    const summary = await deleteAccount("user_delete_me", log, { storage, deleteClerkUser });

    const deleted = calls.filter((c) => c.op === "delete").map((c) => c.table);
    expect(deleted).toEqual(
      expect.arrayContaining([
        "ball_boi_sessions",
        "shot_recordings",
        "player_availability",
        "player_locations",
        "push_subscriptions",
        "expo_push_tokens",
        "user_blocks",
        "rating_history",
        "users",
      ]),
    );
    const reports = calls.find((c) => c.op === "update" && c.table === "content_reports");
    expect(reports?.values).toEqual({ reporterClerkUserId: null });
    expect(deleted).not.toContain("players");

    // Match 100's opponent still has an account, so that recording is kept without its video.
    const kept = calls.find((c) => c.op === "update" && c.table === "ball_boi_sessions");
    expect(kept?.values).toEqual({
      recordedByClerkUserId: DELETED_RECORDER_ID,
      videoObjectPath: null,
      videoContentType: null,
      videoSizeBytes: null,
      aiNarrative: null,
    });

    const anonymize = calls.find((c) => c.op === "update" && c.table === "players");
    expect(anonymize?.values).toEqual({ name: DELETED_PLAYER_NAME, email: null, phone: null, bio: null, clerkUserId: null });

    // Each video once, even when listed twice; Clerk last.
    expect(order).toEqual(["video:/objects/uploads/a", "video:/objects/uploads/b", "clerk"]);
    expect(deleteClerkUser).toHaveBeenCalledWith("user_delete_me");
    expect(summary).toEqual({
      playersAnonymized: 2,
      recordingsDeleted: 1,
      recordingsKeptForOpponents: 1,
      videosDeleted: 2,
      videoDeleteFailures: 0,
    });
  });

  it("deletes a recording outright when the opponent has no account", async () => {
    const { deleteAccount } = await import("../lib/accountDeletion.js");
    selectResults.players = [{ id: 7 }];
    secondSelectResults.players = [{ id: 30, clerkUserId: null }];
    selectResults.ball_boi_sessions = [{ id: 5, matchId: 200, videoObjectPath: "/objects/uploads/c" }];
    selectResults.matches = [{ id: 200, player1Id: 7, player2Id: 30 }];

    const summary = await deleteAccount("user_delete_me", log, {
      storage: { deleteObject: vi.fn() },
      deleteClerkUser: vi.fn(),
    });

    expect(calls.find((c) => c.op === "update" && c.table === "ball_boi_sessions")).toBeUndefined();
    expect(calls.filter((c) => c.op === "delete").map((c) => c.table)).toContain("ball_boi_sessions");
    expect(summary.recordingsDeleted).toBe(1);
    expect(summary.recordingsKeptForOpponents).toBe(0);
  });

  it("skips player cleanup when the account has no league players", async () => {
    const { deleteAccount } = await import("../lib/accountDeletion.js");
    const summary = await deleteAccount("user_delete_me", log, {
      storage: { deleteObject: vi.fn() },
      deleteClerkUser: vi.fn(),
    });
    const tablesTouched = calls.map((c) => c.table);
    expect(tablesTouched).not.toContain("players");
    expect(tablesTouched).not.toContain("player_availability");
    expect(tablesTouched).toContain("users");
    expect(summary.playersAnonymized).toBe(0);
  });

  it("still deletes the account when a video file can't be removed", async () => {
    const { deleteAccount } = await import("../lib/accountDeletion.js");
    selectResults.ball_boi_sessions = [{ id: 1, matchId: 100, videoObjectPath: "/objects/uploads/a" }];
    const deleteClerkUser = vi.fn();

    const summary = await deleteAccount("user_delete_me", log, {
      storage: { deleteObject: vi.fn().mockRejectedValue(new Error("R2 down")) },
      deleteClerkUser,
    });

    expect(deleteClerkUser).toHaveBeenCalledOnce();
    expect(summary.videoDeleteFailures).toBe(1);
    expect(log.warn).toHaveBeenCalled();
  });
});

// ─── DELETE /api/users/me ────────────────────────────────────────────────────

describe("DELETE /api/users/me", () => {
  async function buildApp() {
    vi.doMock("../lib/accountDeletion.js", () => ({
      deleteAccount: vi.fn().mockResolvedValue({
        playersAnonymized: 1,
        recordingsDeleted: 0,
        recordingsKeptForOpponents: 0,
        videosDeleted: 0,
        videoDeleteFailures: 0,
      }),
    }));
    vi.resetModules();
    const { default: usersRouter } = await import("../routes/users.js");
    const { deleteAccount } = await import("../lib/accountDeletion.js");
    const app = express();
    app.use(express.json());
    app.use("/api", usersRouter);
    return { app, deleteAccount: deleteAccount as unknown as ReturnType<typeof vi.fn> };
  }

  it("requires sign-in", async () => {
    const { app, deleteAccount } = await buildApp();
    mockUserId = null;
    const res = await supertest(app).delete("/api/users/me").send({ confirm: "DELETE" });
    expect(res.status).toBe(401);
    expect(deleteAccount).not.toHaveBeenCalled();
  });

  it("refuses without the confirm phrase", async () => {
    const { app, deleteAccount } = await buildApp();
    const res = await supertest(app).delete("/api/users/me").send({});
    expect(res.status).toBe(400);
    expect(deleteAccount).not.toHaveBeenCalled();
  });

  it("deletes the signed-in account", async () => {
    const { app, deleteAccount } = await buildApp();
    const res = await supertest(app).delete("/api/users/me").send({ confirm: "DELETE" });
    expect(res.status).toBe(200);
    expect(res.body.deleted).toBe(true);
    expect(deleteAccount).toHaveBeenCalledWith("user_delete_me", expect.anything());
  });

  it("returns a plain error when deletion fails", async () => {
    const { app, deleteAccount } = await buildApp();
    deleteAccount.mockRejectedValueOnce(new Error("db down"));
    const res = await supertest(app).delete("/api/users/me").send({ confirm: "DELETE" });
    expect(res.status).toBe(500);
    expect(res.body.error).toMatch(/couldn't delete your account/);
  });
});
