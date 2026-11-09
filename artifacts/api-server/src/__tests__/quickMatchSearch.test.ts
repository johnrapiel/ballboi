import { beforeEach, describe, expect, it, vi } from "vitest";
import express from "express";
import supertest from "supertest";

// Quick match against someone found with player search (finding #15): by
// user id, anyone findable or anyone you know, never blocked, and on their
// league-free player row (made if they have none).

vi.mock("@clerk/express", () => ({
  getAuth: () => ({ userId: "me" }),
  clerkMiddleware: () => (_req: unknown, _res: unknown, next: () => void) => next(),
}));
vi.mock("pino", () => ({ default: () => ({ warn: vi.fn(), info: vi.fn(), error: vi.fn() }) }));
vi.mock("../lib/blocks", () => ({ blockedAccountsFor: vi.fn().mockResolvedValue(new Set()) }));

const search = vi.hoisted(() => ({
  findableUser: vi.fn(),
  connected: vi.fn(),
  blocked: vi.fn(),
  findable: vi.fn(),
}));
vi.mock("../lib/playerSearchRepo", () => ({
  DrizzlePlayerSearchRepo: class {
    findableUser = search.findableUser;
    connected = search.connected;
    blocked = search.blocked;
    findable = search.findable;
  },
}));

// "Was that you?" (Session G): strangers get a stand-in and a request.
const strangers = vi.hoisted(() => ({ isStranger: vi.fn(), create: vi.fn() }));
vi.mock("../services/push/liveActivity", () => ({ startForNewViewer: async () => undefined }));
vi.mock("../services/push/opponentRequests", () => ({
  quickMatchStranger: strangers.isStranger,
  createStrangerQuickMatch: strangers.create,
  requestForCode: async () => null,
  markRequestYes: async () => undefined,
}));

const inserts: { table: string; values: Record<string, unknown> }[] = [];
let nextId = 50;

function chain(result: () => unknown[]) {
  const c: Record<string, unknown> = {};
  for (const m of ["from", "where", "orderBy", "limit"]) c[m] = () => c;
  c.then = (ok: (v: unknown) => unknown, bad?: (e: unknown) => unknown) => Promise.resolve(result()).then(ok, bad);
  return c;
}

const mockDb = {
  // The caller's own player rows (myPlayerId).
  select: () => chain(() => [{ id: 1, name: "Me", leagueId: null }]),
  insert: (t: { __name: string }) => ({
    values: (values: Record<string, unknown>) => {
      inserts.push({ table: t.__name, values });
      return { returning: () => Promise.resolve([{ id: nextId++ }]) };
    },
  }),
};

const t = (name: string) => new Proxy({ __name: name } as Record<string, unknown>, { get: (o, k) => (k in o ? o[k as string] : {}) });

vi.mock("@workspace/db", () => ({
  get db() {
    return mockDb;
  },
  ballBoiSessionsTable: t("ball_boi_sessions"),
  matchesTable: t("matches"),
  matchInvitesTable: t("match_invites"),
  playersTable: t("players"),
  recordingConsentTable: t("ball_boi_recording_consent"),
  usersTable: t("users"),
}));

vi.mock("drizzle-orm", () => ({
  eq: (a: unknown, b: unknown) => ({ a, b }),
  and: (...a: unknown[]) => a,
  or: (...a: unknown[]) => a,
  isNull: (a: unknown) => a,
  ne: (a: unknown, b: unknown) => ({ a, b }),
  inArray: (a: unknown, b: unknown) => ({ a, b }),
}));

async function app() {
  const { default: router } = await import("../routes/quickMatch.js");
  const a = express();
  a.use(express.json());
  a.use("/api", router);
  return supertest(a);
}

const found = (extra: Record<string, unknown> = {}) => ({
  clerkUserId: "cara",
  userId: 7,
  playerId: 70,
  name: "Cara Lin",
  avatarUrl: null,
  ...extra,
});

beforeEach(() => {
  inserts.length = 0;
  nextId = 50;
  search.findableUser.mockReset().mockResolvedValue(null);
  search.connected.mockReset().mockResolvedValue([]);
  search.blocked.mockReset().mockResolvedValue(new Set());
  strangers.isStranger.mockReset().mockResolvedValue(false);
  strangers.create.mockReset().mockResolvedValue({ matchId: 88 });
});

describe("POST /recording/quick-matches with opponentUserId", () => {
  it("records against a findable player on their own player row", async () => {
    search.findableUser.mockResolvedValue(found());
    const res = await (await app()).post("/api/recording/quick-matches").send({ opponentUserId: 7 }).expect(201);
    expect(search.findableUser).toHaveBeenCalledWith("me", 7);
    expect(res.body).toEqual({ matchId: 50, opponentName: "Cara Lin", invite: null });
    expect(inserts).toEqual([{ table: "matches", values: expect.objectContaining({ player1Id: 1, player2Id: 70, generatedFrom: "quick_match" }) }]);
  });

  it("makes a league-free player row for someone in no league yet", async () => {
    search.findableUser.mockResolvedValue(found({ playerId: null }));
    await (await app()).post("/api/recording/quick-matches").send({ opponentUserId: 7 }).expect(201);
    expect(inserts[0]).toEqual({ table: "players", values: { name: "Cara Lin", clerkUserId: "cara" } });
    expect(inserts[1].values).toMatchObject({ player1Id: 1, player2Id: 50 });
  });

  it("still finds a league mate who isn't findable (say, a hidden profile)", async () => {
    search.connected.mockResolvedValue([{ ...found(), inYourLeagues: true, playedBefore: false }]);
    await (await app()).post("/api/recording/quick-matches").send({ opponentUserId: 7 }).expect(201);
  });

  it("refuses a blocked league mate and anyone not findable", async () => {
    search.connected.mockResolvedValue([{ ...found(), inYourLeagues: true, playedBefore: false }]);
    search.blocked.mockResolvedValue(new Set(["cara"]));
    const res = await (await app()).post("/api/recording/quick-matches").send({ opponentUserId: 7 }).expect(404);
    expect(res.body.error).toBe("This player isn't available. Search again, or add someone not on Ball Boi.");
    expect(inserts).toEqual([]);
  });

  it("records a stranger against a stand-in, with Was that you? (decision 124)", async () => {
    search.findableUser.mockResolvedValue(found());
    strangers.isStranger.mockResolvedValue(true);
    const res = await (await app()).post("/api/recording/quick-matches").send({ opponentUserId: 7 }).expect(201);
    expect(strangers.isStranger).toHaveBeenCalledWith("me", "cara");
    expect(strangers.create).toHaveBeenCalledWith(
      expect.objectContaining({ recorderId: "me", recorderPlayerId: 1, opponentClerkUserId: "cara", opponentName: "Cara Lin" }),
    );
    // The recorder never gets the request's code.
    expect(res.body).toEqual({ matchId: 88, opponentName: "Cara Lin", invite: null });
    expect(inserts).toEqual([]);
  });
});
