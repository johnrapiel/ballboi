import { beforeEach, describe, expect, it, vi } from "vitest";
import express from "express";
import supertest from "supertest";
import { flipScore, inviteUrl, newInviteCode, parseQuickMatch, parseSideScore, pickableOpponents } from "../lib/quickMatch";

describe("parseQuickMatch", () => {
  it("defaults to singles and takes a picked player", () => {
    expect(parseQuickMatch({ opponentPlayerId: 12 })).toEqual({ ok: true, opponentPlayerId: 12 });
  });

  it("takes a typed name, tidied", () => {
    expect(parseQuickMatch({ format: "singles", opponentName: "  Sam   Lee " })).toEqual({ ok: true, opponentName: "Sam Lee" });
  });

  it("turns doubles away with the spec's message", () => {
    expect(parseQuickMatch({ format: "doubles", opponentName: "Sam" })).toEqual({
      ok: false,
      error: "Ball Boi analyzes singles for now. Doubles is coming.",
    });
  });

  it("needs exactly one opponent", () => {
    expect(parseQuickMatch({}).ok).toBe(false);
    expect(parseQuickMatch({ opponentPlayerId: 3, opponentName: "Sam" }).ok).toBe(false);
    expect(parseQuickMatch({ opponentPlayerId: "3" }).ok).toBe(false);
    expect(parseQuickMatch({ opponentName: "x".repeat(61) }).ok).toBe(false);
  });
});

describe("pickableOpponents", () => {
  it("lists each account once, without you, placeholders, or blocked people", () => {
    const rows = [
      { id: 5, name: "Alex Kim", clerkUserId: "alex" },
      { id: 2, name: "Alex Kim", clerkUserId: "alex" },
      { id: 3, name: "Me", clerkUserId: "me" },
      { id: 4, name: "Sam Placeholder", clerkUserId: null },
      { id: 6, name: "Blocked Bo", clerkUserId: "bo" },
      { id: 7, name: "Ava Diaz", clerkUserId: "ava" },
    ];
    expect(pickableOpponents(rows, "me", new Set(["bo"]))).toEqual([
      { playerId: 2, name: "Alex Kim" },
      { playerId: 7, name: "Ava Diaz" },
    ]);
  });
});

describe("invite codes", () => {
  it("are 8 unambiguous characters in a ballboi.tennis link", () => {
    const code = newInviteCode();
    expect(code).toMatch(/^[A-HJ-NP-Z2-9]{8}$/);
    expect(inviteUrl(code)).toBe(`https://ballboi.tennis/record/invite/${code}`);
  });
});

describe("parseSideScore and flipScore", () => {
  it("reads a score from the entering player's side", () => {
    expect(parseSideScore("6-3, 7-6(4)")).toEqual({ ok: true, score: "6-3, 7-6(4)", winnerSide: 1 });
    expect(parseSideScore("3-6,6-4, 7-10")).toEqual({ ok: true, score: "3-6, 6-4, 7-10", winnerSide: 2 });
  });

  it("explains impossible scores", () => {
    expect(parseSideScore("6-6")).toMatchObject({ ok: false });
    // Sets and games level: no winner.
    expect(parseSideScore("6-3, 3-6")).toMatchObject({ ok: false });
    expect(parseSideScore("six-three")).toMatchObject({ ok: false });
    expect(parseSideScore("")).toMatchObject({ ok: false });
    expect(parseSideScore(undefined)).toMatchObject({ ok: false });
  });

  it("flips to the other side, keeping tiebreak points", () => {
    expect(flipScore("6-3, 7-6(4)")).toBe("3-6, 6-7(4)");
  });
});

// ─── Claim route ────────────────────────────────────────────────────────────

let mockUserId: string | null = "user_joiner";

vi.mock("@clerk/express", () => ({
  getAuth: () => ({ userId: mockUserId }),
  clerkMiddleware: () => (_req: unknown, _res: unknown, next: () => void) => next(),
}));
vi.mock("pino", () => ({ default: () => ({ warn: vi.fn(), info: vi.fn(), error: vi.fn() }) }));
vi.mock("../lib/blocks", () => ({ blockedAccountsFor: vi.fn().mockResolvedValue(new Set()) }));
// "Was that you?" requests (Session G): none unless a test sets one.
let mockRequest: { opponentClerkUserId: string; status: string } | null = null;
const requestsMarkedYes: string[] = [];
vi.mock("../services/push/opponentRequests", () => ({
  requestForCode: async () => mockRequest,
  markRequestYes: async (_tx: unknown, code: string) => void requestsMarkedYes.push(code),
  quickMatchStranger: async () => false,
  createStrangerQuickMatch: async () => ({ matchId: 0 }),
}));

const selectQueue: unknown[][] = [];
let claimResult: unknown[] = [];
const playerUpdates: unknown[] = [];

function chain(result: () => unknown[]) {
  const c: Record<string, unknown> = {};
  for (const m of ["from", "where", "orderBy", "limit"]) c[m] = () => c;
  c.then = (ok: (v: unknown) => unknown, bad?: (e: unknown) => unknown) => Promise.resolve(result()).then(ok, bad);
  return c;
}

const tx = {
  update: (t: { __name: string }) => ({
    set: (values: unknown) => ({
      where: () => {
        if (t.__name === "players") playerUpdates.push(values);
        const done = Promise.resolve(t.__name === "match_invites" ? claimResult : []);
        return Object.assign(done, { returning: () => done });
      },
    }),
  }),
  insert: () => ({ values: () => ({ onConflictDoUpdate: () => Promise.resolve() }) }),
};

const mockDb = {
  select: () => chain(() => selectQueue.shift() ?? []),
  transaction: async (fn: (t: typeof tx) => unknown) => fn(tx),
};

const t = (name: string) => new Proxy({ __name: name } as Record<string, unknown>, { get: (o, k) => (k in o ? o[k as string] : {}) });

vi.mock("@workspace/db", () => ({
  get db() {
    return mockDb;
  },
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

const invite = { code: "ABCD2345", matchId: 9, placeholderPlayerId: 4, createdByClerkUserId: "user_recorder", claimedByClerkUserId: null };

beforeEach(() => {
  mockUserId = "user_joiner";
  selectQueue.length = 0;
  claimResult = [];
  playerUpdates.length = 0;
  mockRequest = null;
  requestsMarkedYes.length = 0;
});

describe("POST /recording/invites/:code/claim", () => {
  it("Was that you? Yes: links the match and marks the request (decision 124)", async () => {
    mockRequest = { opponentClerkUserId: "user_joiner", status: "pending" };
    selectQueue.push([invite], [{ displayName: "Sam Lee" }]);
    claimResult = [{ ...invite, claimedByClerkUserId: "user_joiner" }];
    const res = await (await app()).post("/api/recording/invites/ABCD2345/claim").send({ trainingEnabled: true });
    expect(res.status).toBe(200);
    expect(requestsMarkedYes).toEqual(["ABCD2345"]);
  });

  it("Was that you? only its person can answer", async () => {
    mockRequest = { opponentClerkUserId: "someone_else", status: "pending" };
    selectQueue.push([invite]);
    const res = await (await app()).post("/api/recording/invites/ABCD2345/claim").send({ trainingEnabled: true });
    expect(res.status).toBe(404);
    expect(playerUpdates).toEqual([]);
  });

  it("Was that you? after Not me, Yes doesn't link it", async () => {
    mockRequest = { opponentClerkUserId: "user_joiner", status: "not_me" };
    selectQueue.push([invite]);
    const res = await (await app()).post("/api/recording/invites/ABCD2345/claim").send({ trainingEnabled: true });
    expect(res.status).toBe(409);
    expect(playerUpdates).toEqual([]);
  });

  it("attaches the placeholder to the person who opens the link", async () => {
    selectQueue.push([invite], [{ displayName: "Sam Lee" }]);
    claimResult = [{ ...invite, claimedByClerkUserId: "user_joiner" }];
    const res = await (await app()).post("/api/recording/invites/abcd2345/claim").send({ trainingEnabled: false });
    expect(res.status).toBe(200);
    expect(res.body).toEqual({ matchId: 9 });
    expect(playerUpdates).toEqual([{ clerkUserId: "user_joiner", name: "Sam Lee" }]);
  });

  it("refers the recorder back to the player they recorded", async () => {
    mockUserId = "user_recorder";
    selectQueue.push([invite]);
    const res = await (await app()).post("/api/recording/invites/ABCD2345/claim").send({ trainingEnabled: true });
    expect(res.status).toBe(400);
  });

  it("lets only the first person claim it", async () => {
    selectQueue.push([invite], [{ displayName: "Sam Lee" }]);
    claimResult = [];
    const res = await (await app()).post("/api/recording/invites/ABCD2345/claim").send({ trainingEnabled: true });
    expect(res.status).toBe(409);
    expect(playerUpdates).toEqual([]);
  });

  it("needs the training choice", async () => {
    const res = await (await app()).post("/api/recording/invites/ABCD2345/claim").send({});
    expect(res.status).toBe(400);
  });
});

describe("Quick match scores: as many sets as were played (Nov 4, John)", () => {
  it("saves one set", () => {
    expect(parseSideScore("6-4")).toEqual({ ok: true, score: "6-4", winnerSide: 1 });
    expect(parseSideScore("5-7")).toEqual({ ok: true, score: "5-7", winnerSide: 2 });
  });

  it("saves two sets, including one set all decided on games", () => {
    expect(parseSideScore("6-3, 6-4")).toEqual({ ok: true, score: "6-3, 6-4", winnerSide: 1 });
    expect(parseSideScore("6-2, 4-6")).toEqual({ ok: true, score: "6-2, 4-6", winnerSide: 1 });
    expect(parseSideScore("6-4, 0-6")).toEqual({ ok: true, score: "6-4, 0-6", winnerSide: 2 });
  });

  it("saves four sets, and keeps going after someone has won two", () => {
    expect(parseSideScore("6-3, 4-6, 6-2, 6-1")).toEqual({ ok: true, score: "6-3, 4-6, 6-2, 6-1", winnerSide: 1 });
    // Two sets all: games decide it, 17-19.
    expect(parseSideScore("6-3, 6-4, 2-6, 3-6")).toEqual({ ok: true, score: "6-3, 6-4, 2-6, 3-6", winnerSide: 2 });
    expect(parseSideScore("6-3, 6-4, 6-1")).toMatchObject({ ok: true, winnerSide: 1 });
  });

  it("takes a match tiebreak as the last set, counted as one game", () => {
    expect(parseSideScore("6-4, 4-6, 7-10")).toEqual({ ok: true, score: "6-4, 4-6, 7-10", winnerSide: 2 });
    expect(parseSideScore("10-7")).toMatchObject({ ok: false });
    expect(parseSideScore("10-7, 6-3")).toMatchObject({ ok: false });
  });

  it("refuses level sets and games, with a reason", () => {
    expect(parseSideScore("6-4, 4-6")).toEqual({ ok: false, error: "The sets and games are level, so there's no winner. Add the set or tiebreak that decided it." });
  });

  it("still refuses a set that isn't real, with the same reason as leagues", () => {
    expect(parseSideScore("9-2")).toEqual({ ok: false, error: "9-2 isn't a valid set. A set ends 6-0 to 6-4, 7-5 or 7-6." });
    expect(parseSideScore("6-3, 6-5")).toEqual({
      ok: false,
      error: "6-5 isn't a valid set. A set ends 6-0 to 6-4, 7-5 or 7-6. The last set can also be a match tiebreak, like 10-7.",
    });
    expect(parseSideScore("6-3, 6-3, 6-3, 6-3, 6-3, 6-3")).toEqual({ ok: false, error: "A Quick match can have up to 5 sets." });
  });
});
