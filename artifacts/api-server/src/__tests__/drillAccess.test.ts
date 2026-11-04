import { describe, it, expect, vi, beforeEach } from "vitest";
import express from "express";
import supertest from "supertest";
import type { Row } from "./fakeDb";

// PR 8, row 3: a drill's leaderboard belongs to its league. Someone outside a
// Private league can't read its drill results (or add to them); an Open
// league's drills are open to anyone signed in, like the league itself.

let mockUserId: string | null = "user_member";
vi.mock("@clerk/express", () => ({
  getAuth: () => ({ userId: mockUserId }),
  clerkMiddleware: () => (_req: unknown, _res: unknown, next: () => void) => next(),
}));
vi.mock("../lib/logger", () => ({ logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() } }));
vi.mock("../middlewares/requireAdmin", () => ({ requireAdmin: vi.fn() }));

type Query = { text: string; values: unknown[] };
const drills: Record<number, number> = { 7: 1, 8: 2 }; // drill id → league id
const executed: Query[] = [];
const rows: Record<string, Row[]> = {};
vi.mock("@workspace/db", async () => {
  const { fakeDb, table } = await import("./fakeDb");
  const db = fakeDb(rows);
  db.execute = (async (q: Query) => {
    executed.push(q);
    if (q.text.includes("FROM drills WHERE id")) {
      const leagueId = drills[q.values[0] as number];
      return { rows: leagueId ? [{ league_id: leagueId }] : [] };
    }
    if (q.text.includes("GROUP BY dr.user_id")) return { rows: [{ user_id: "user_member", best_score: 80, attempts: 2 }] };
    if (q.text.includes("INSERT INTO drill_results")) return { rows: [{ id: 1 }] };
    return { rows: [] };
  }) as unknown as typeof db.execute;
  return {
    db,
    leaguesTable: table("leagues", ["id", "visibility", "createdByClerkUserId"]),
    playersTable: table("players", ["id", "leagueId", "clerkUserId"]),
    leagueAdminsTable: table("league_admins", ["leagueId", "clerkUserId"]),
  };
});
vi.mock("drizzle-orm", async () => ({
  ...(await import("./fakeDb")).drizzleFake,
  sql: Object.assign((strings: TemplateStringsArray, ...values: unknown[]) => ({ text: strings.join("?"), values }), {
    raw: (s: string) => ({ text: s, values: [] }),
  }),
}));

async function app() {
  const { default: router } = await import("../routes/drills.js");
  const a = express();
  a.use(express.json());
  a.use("/api", router);
  return supertest(a);
}

const ran = (part: string) => executed.some((q) => q.text.includes(part));

beforeEach(() => {
  mockUserId = "user_member";
  executed.length = 0;
  Object.assign(rows, {
    leagues: [
      { id: 1, visibility: "private", createdByClerkUserId: "user_owner" },
      { id: 2, visibility: "open", createdByClerkUserId: "user_other" },
    ],
    players: [{ id: 10, leagueId: 1, clerkUserId: "user_member" }],
    league_admins: [{ leagueId: 1, clerkUserId: "user_owner" }],
  });
});

describe("GET /drills/:id/leaderboard", () => {
  it("shows a Private league's drill results to its players", async () => {
    const res = await (await app()).get("/api/drills/7/leaderboard");
    expect(res.status).toBe(200);
    expect(res.body).toEqual([{ user_id: "user_member", best_score: 80, attempts: 2 }]);
  });

  it("shows them to the league's admin", async () => {
    mockUserId = "user_owner";
    expect((await (await app()).get("/api/drills/7/leaderboard")).status).toBe(200);
  });

  it("refuses someone outside the league, without reading the results", async () => {
    mockUserId = "user_stranger";
    const res = await (await app()).get("/api/drills/7/leaderboard?period=week");
    expect(res.status).toBe(403);
    expect(ran("drill_results")).toBe(false);
  });

  it("an Open league's drills are open to anyone signed in", async () => {
    mockUserId = "user_stranger";
    expect((await (await app()).get("/api/drills/8/leaderboard")).status).toBe(200);
  });

  it("needs sign-in", async () => {
    mockUserId = null;
    expect((await (await app()).get("/api/drills/7/leaderboard")).status).toBe(401);
  });

  it("answers 404 for a drill that doesn't exist and 400 for a bad id", async () => {
    expect((await (await app()).get("/api/drills/99/leaderboard")).status).toBe(404);
    expect((await (await app()).get("/api/drills/abc/leaderboard")).status).toBe(400);
  });

  it("passes the drill id as a parameter, not as SQL text", async () => {
    await (await app()).get("/api/drills/7/leaderboard?period=month");
    const q = executed.find((x) => x.text.includes("GROUP BY dr.user_id"))!;
    expect(q.values).toContain(7);
  });
});

describe("POST /drills/:id/results", () => {
  it("someone outside the league can't add results to its drill", async () => {
    mockUserId = "user_stranger";
    const res = await (await app()).post("/api/drills/7/results").send({ shotsAttempted: 10, shotsSuccessful: 8 });
    expect(res.status).toBe(403);
    expect(ran("INSERT INTO drill_results")).toBe(false);
  });

  it("a league player can", async () => {
    const res = await (await app()).post("/api/drills/7/results").send({ shotsAttempted: 10, shotsSuccessful: 8 });
    expect(res.status).toBe(201);
  });
});
