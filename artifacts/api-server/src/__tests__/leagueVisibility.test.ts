import { describe, it, expect, vi, beforeEach } from "vitest";
import express from "express";
import supertest from "supertest";
import type { Row } from "./fakeDb";

// C11: the league list, league details and standings need sign-in, and a
// Private league shows only to its players and admins. Open leagues show to
// anyone signed in. (Joining by invite code uses GET /invites/:code, which is
// unchanged.)

let mockUserId: string | null = "user_member";
vi.mock("@clerk/express", () => ({
  getAuth: () => ({ userId: mockUserId }),
  clerkMiddleware: () => (_req: unknown, _res: unknown, next: () => void) => next(),
  clerkClient: { users: { getUser: vi.fn() } },
}));

const rows: Record<string, Row[]> = {};
vi.mock("@workspace/db", async () => {
  const { fakeDb, table } = await import("./fakeDb");
  return {
    db: fakeDb(rows),
    leaguesTable: table("leagues", ["id", "createdAt", "createdByClerkUserId", "visibility"]),
    playersTable: table("players", ["id", "leagueId", "clerkUserId", "leftAt"]),
    matchesTable: table("matches", ["id", "leagueId"]),
    leagueRoundsTable: table("league_rounds", ["id", "leagueId"]),
    leagueAdminsTable: table("league_admins", ["leagueId", "clerkUserId", "role"]),
  };
});
vi.mock("drizzle-orm", async () => (await import("./fakeDb")).drizzleFake);
vi.mock("@workspace/api-zod", () => ({
  CreateLeagueBody: { safeParse: (v: unknown) => ({ success: true, data: v }) },
  UpdateLeagueBody: { safeParse: (v: unknown) => ({ success: true, data: v }) },
}));
vi.mock("../services/leagueRounds.js", () => ({ runLeagueDay: vi.fn() }));
vi.mock("../lib/autoLinkPlayer.js", () => ({ autoLinkPlayer: vi.fn() }));
vi.mock("../services/seasonService.js", () => ({ getPastSeasonNames: vi.fn().mockResolvedValue([]) }));
vi.mock("../middlewares/requireAdmin.js", () => ({ requireAdmin: vi.fn() }));

const day = new Date("2026-10-01T00:00:00Z");
const league = (id: number, visibility: string, createdBy: string) => ({
  id, name: `League ${id}`, visibility, createdByClerkUserId: createdBy, createdAt: day, updatedAt: day, endedAt: null,
});

async function app() {
  const { default: router } = await import("../routes/leagues.js");
  const a = express();
  a.use(express.json());
  a.use("/api", router);
  return supertest(a);
}

beforeEach(() => {
  mockUserId = "user_member";
  rows.leagues = [
    league(1, "private", "user_owner"), // user_member plays here
    league(2, "private", "user_owner"), // user_member isn't in it
    league(3, "open", "user_owner"),
    league(4, "private", "user_owner"), // user_member is a co-admin, not playing
  ];
  rows.players = [
    { id: 11, leagueId: 1, clerkUserId: "user_member", name: "Me", leftAt: null },
    { id: 21, leagueId: 2, clerkUserId: "user_other", name: "Stranger", leftAt: null },
  ];
  rows.league_admins = [{ leagueId: 4, clerkUserId: "user_member", role: "co_admin" }];
  rows.matches = [];
});

describe("GET /leagues", () => {
  it("needs sign-in", async () => {
    mockUserId = null;
    expect((await (await app()).get("/api/leagues")).status).toBe(401);
  });

  it("with clerkUserId (what the Leagues tab sends) lists only my leagues", async () => {
    const res = await (await app()).get("/api/leagues").query({ clerkUserId: "user_member" });
    expect(res.status).toBe(200);
    expect(res.body.map((l: { id: number }) => l.id).sort()).toEqual([1, 4]);
  });

  it("won't list someone else's leagues", async () => {
    const res = await (await app()).get("/api/leagues").query({ clerkUserId: "user_other" });
    expect(res.status).toBe(403);
  });

  it("without a filter, adds Open leagues but never other people's Private ones", async () => {
    const res = await (await app()).get("/api/leagues");
    expect(res.body.map((l: { id: number }) => l.id).sort()).toEqual([1, 3, 4]);
  });
});

describe("GET /leagues/:id and /leagues/:id/standings", () => {
  for (const path of ["/api/leagues/%d", "/api/leagues/%d/standings"]) {
    const at = (id: number) => path.replace("%d", String(id));

    it(`${path}: needs sign-in`, async () => {
      mockUserId = null;
      expect((await (await app()).get(at(1))).status).toBe(401);
    });

    it(`${path}: a player and an admin see their Private league`, async () => {
      expect((await (await app()).get(at(1))).status).toBe(200);
      expect((await (await app()).get(at(4))).status).toBe(200);
    });

    it(`${path}: an outsider can't see a Private league`, async () => {
      const res = await (await app()).get(at(2));
      expect(res.status).toBe(403);
      expect(JSON.stringify(res.body)).not.toContain("Stranger");
    });

    it(`${path}: anyone signed in sees an Open league`, async () => {
      expect((await (await app()).get(at(3))).status).toBe(200);
    });

    it(`${path}: 404 for a league that doesn't exist`, async () => {
      expect((await (await app()).get(at(99))).status).toBe(404);
    });
  }

  it("standings of my league list its players", async () => {
    const res = await (await app()).get("/api/leagues/1/standings");
    expect(res.body.map((s: { playerName: string }) => s.playerName)).toEqual(["Me"]);
  });
});
