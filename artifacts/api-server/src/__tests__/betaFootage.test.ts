import { beforeEach, describe, expect, it, vi } from "vitest";
import express from "express";
import supertest from "supertest";
import { pickBetaFootage, type BetaFootageRow } from "../lib/betaFootage";

// Beta recordings for the labeled test set: who's in, who's out, and that only
// the admin can get the download links.

const ADMIN_EMAIL = "admin@example.com";
let mockUserId: string | null = "user_admin";
let mockEmail = ADMIN_EMAIL;

vi.mock("@clerk/express", () => ({
  getAuth: () => ({ userId: mockUserId }),
  clerkMiddleware: () => (_req: unknown, _res: unknown, next: () => void) => next(),
  clerkClient: {
    users: {
      getUser: async () => ({
        emailAddresses: [{ id: "e1", emailAddress: mockEmail }],
        primaryEmailAddressId: "e1",
      }),
    },
  },
}));
vi.mock("../lib/logger", () => ({ logger: { warn: vi.fn(), info: vi.fn(), error: vi.fn() } }));
vi.mock("@workspace/db", () => ({ db: {}, ballBoiSessionsTable: {}, matchesTable: {}, recordingConsentTable: {} }));
vi.mock("../lib/objectStorage", () => {
  class ObjectNotFoundError extends Error {}
  return { ObjectNotFoundError, ObjectStorageService: class {} };
});

const at = (iso: string) => new Date(iso);
const held = (sessionId: number, extra: Record<string, unknown> = {}) => ({
  heldForBeta: true,
  trainingVideoPath: `/objects/training/session-${sessionId}.mp4`,
  ...extra,
});

function row(over: Partial<BetaFootageRow> & { sessionId: number; matchId: number }): BetaFootageRow {
  return {
    recordingStartedAt: at("2026-11-08T18:00:00Z"),
    metadata: held(over.sessionId),
    releaseVersion: 1,
    ...over,
  };
}

describe("pickBetaFootage", () => {
  it("includes a held recording whose recorder agreed to the release", () => {
    const plan = pickBetaFootage([row({ sessionId: 1, matchId: 10 })]);
    expect(plan.eligible).toEqual([
      {
        matchId: 10,
        sessionId: 1,
        recordedAt: at("2026-11-08T18:00:00Z"),
        objectPath: "/objects/training/session-1.mp4",
        testSet: false,
        audioPaths: [],
        audioHeldAt: null,
      },
    ]);
    expect(plan.withdrawnMatchIds).toEqual([]);
  });

  it("leaves out recorders who never agreed to the release", () => {
    expect(pickBetaFootage([row({ sessionId: 1, matchId: 10, releaseVersion: null })]).eligible).toEqual([]);
    expect(pickBetaFootage([row({ sessionId: 1, matchId: 10, releaseVersion: 0 })]).eligible).toEqual([]);
  });

  it("leaves out recordings that aren't held for beta", () => {
    const notHeld = { trainingVideoPath: "/objects/training/session-1.mp4", keptForTrainingAt: "2026-11-08T19:00:00Z" };
    expect(pickBetaFootage([row({ sessionId: 1, matchId: 10, metadata: notHeld })]).eligible).toEqual([]);
    expect(pickBetaFootage([row({ sessionId: 2, matchId: 11, metadata: { heldForBeta: true } })]).eligible).toEqual([]);
    expect(pickBetaFootage([row({ sessionId: 3, matchId: 12, metadata: null })]).eligible).toEqual([]);
    const rawUpload = { heldForBeta: true, trainingVideoPath: "/objects/uploads/abc" };
    expect(pickBetaFootage([row({ sessionId: 4, matchId: 13, metadata: rawUpload })]).eligible).toEqual([]);
  });

  it("leaves out every recording of a match a player withdrew from, and lists the match", () => {
    const plan = pickBetaFootage([
      row({ sessionId: 1, matchId: 10, metadata: held(1, { withdrawnAt: "2026-11-09T00:00:00Z" }) }),
      row({ sessionId: 2, matchId: 10 }),
      row({ sessionId: 3, matchId: 11 }),
      row({ sessionId: 4, matchId: 12, metadata: { withdrawnAt: "2026-11-09T00:00:00Z", trainingVideoPath: null } }),
    ]);
    expect(plan.eligible.map((e) => e.matchId)).toEqual([11]);
    expect(plan.withdrawnMatchIds).toEqual([10, 12]);
  });

  it("ignores training consent: a held copy counts whatever the training toggle says", () => {
    const plan = pickBetaFootage([row({ sessionId: 1, matchId: 10, metadata: held(1, { trainingEligible: false }) })]);
    expect(plan.eligible).toHaveLength(1);
  });

  it("keeps one file per match: the earliest recording", () => {
    const plan = pickBetaFootage([
      row({ sessionId: 7, matchId: 10, recordingStartedAt: at("2026-11-08T18:05:00Z") }),
      row({ sessionId: 6, matchId: 10, recordingStartedAt: at("2026-11-08T18:00:00Z") }),
      row({ sessionId: 9, matchId: 20, recordingStartedAt: at("2026-11-07T10:00:00Z") }),
    ]);
    expect(plan.eligible.map((e) => [e.matchId, e.sessionId])).toEqual([
      [20, 9],
      [10, 6],
    ]);
  });

  it("falls back to the other player's recording when the earliest recorder never agreed", () => {
    const plan = pickBetaFootage([
      row({ sessionId: 6, matchId: 10, recordingStartedAt: at("2026-11-08T18:00:00Z"), releaseVersion: null }),
      row({ sessionId: 7, matchId: 10, recordingStartedAt: at("2026-11-08T18:05:00Z") }),
    ]);
    expect(plan.eligible.map((e) => e.sessionId)).toEqual([7]);
  });
});

describe("GET /api/admin/beta-footage", () => {
  let rows: BetaFootageRow[];
  let missing: Set<string>;
  let flags: [number, boolean][];

  beforeEach(() => {
    flags = [];
    mockUserId = "user_admin";
    mockEmail = ADMIN_EMAIL;
    process.env.ADMIN_EMAIL = ADMIN_EMAIL;
    rows = [
      row({ sessionId: 1, matchId: 10 }),
      row({ sessionId: 2, matchId: 11, releaseVersion: null }),
      row({ sessionId: 3, matchId: 12, metadata: held(3, { withdrawnAt: "2026-11-09T00:00:00Z" }) }),
    ];
    missing = new Set();
  });

  async function app() {
    vi.resetModules();
    const { createLabelingRouter } = await import("../routes/labeling");
    const { ObjectNotFoundError } = await import("../lib/objectStorage");
    const a = express();
    a.use(express.json());
    a.use(
      "/api",
      createLabelingRouter({
        listRows: async () => rows,
        signDownload: async (path, ttl) => {
          if (missing.has(path)) throw new ObjectNotFoundError();
          return `https://r2.example/${path.slice("/objects/".length)}?ttl=${ttl}`;
        },
        now: () => at("2026-11-09T01:00:00Z"),
        setTestSet: async (matchId, on) => {
          flags.push([matchId, on]);
          return matchId !== 404;
        },
      }),
    );
    return supertest(a);
  }

  it("refuses anyone who isn't signed in", async () => {
    mockUserId = null;
    const res = await (await app()).get("/api/admin/beta-footage");
    expect(res.status).toBe(401);
  });

  it("refuses signed-in players who aren't the admin", async () => {
    mockEmail = "player@example.com";
    const res = await (await app()).get("/api/admin/beta-footage");
    expect(res.status).toBe(403);
  });

  it("gives the admin a two-hour link per eligible match and the withdrawn match IDs", async () => {
    const res = await (await app()).get("/api/admin/beta-footage");
    expect(res.status).toBe(200);
    expect(res.body).toEqual({
      matches: [
        {
          matchId: 10,
          sessionId: 1,
          recordedAt: "2026-11-08T18:00:00.000Z",
          url: "https://r2.example/training/session-1.mp4?ttl=7200",
          expiresAt: "2026-11-09T03:00:00.000Z",
          testSet: false,
          audioUrls: [],
          audioDaysLeft: null,
        },
      ],
      withdrawnMatchIds: [12],
      missingCount: 0,
    });
  });

  it("skips a held copy that's missing from storage and counts it", async () => {
    missing.add("/objects/training/session-1.mp4");
    const res = await (await app()).get("/api/admin/beta-footage");
    expect(res.status).toBe(200);
    expect(res.body.matches).toEqual([]);
    expect(res.body.missingCount).toBe(1);
  });

  it("shows days left in the audio window, and gives audio links only for test-set matches", async () => {
    const audio = { audioHeldAt: "2026-11-01T01:00:00Z", segmentPaths: ["/objects/uploads/raw-2b"] };
    rows = [
      row({ sessionId: 1, matchId: 10, metadata: held(1, audio), videoObjectPath: "/objects/uploads/raw-1" }),
      row({ sessionId: 2, matchId: 11, metadata: held(2, audio), videoObjectPath: "/objects/uploads/raw-2", testSetAt: at("2026-11-05T00:00:00Z") }),
    ];
    const res = await (await app()).get("/api/admin/beta-footage");
    const [unflagged, test] = res.body.matches;
    expect(unflagged).toMatchObject({ matchId: 10, testSet: false, audioUrls: [], audioDaysLeft: 22 });
    expect(test).toMatchObject({ matchId: 11, testSet: true, audioDaysLeft: null });
    expect(test.audioUrls).toEqual([
      "https://r2.example/uploads/raw-2?ttl=7200",
      "https://r2.example/uploads/raw-2b?ttl=7200",
    ]);
  });

  it("lets the admin flag and unflag a match as test set", async () => {
    const r = await app();
    expect((await r.put("/api/admin/beta-footage/11/test-set").send({ testSet: true })).body).toEqual({ matchId: 11, testSet: true });
    expect((await r.put("/api/admin/beta-footage/11/test-set").send({ testSet: false })).status).toBe(200);
    expect(flags).toEqual([
      [11, true],
      [11, false],
    ]);
    expect((await r.put("/api/admin/beta-footage/404/test-set").send({ testSet: true })).status).toBe(404);
    expect((await r.put("/api/admin/beta-footage/11/test-set").send({ testSet: "yes" })).status).toBe(400);
  });

  it("only the admin can flag the test set", async () => {
    mockEmail = "player@example.com";
    const res = await (await app()).put("/api/admin/beta-footage/11/test-set").send({ testSet: true });
    expect(res.status).toBe(403);
    expect(flags).toEqual([]);
  });
});
