import { describe, it, expect, vi, afterEach } from "vitest";
import express from "express";
import supertest from "supertest";

// Dev-only time controls are refused in production, and need a league admin.

vi.mock("@clerk/express", () => ({ getAuth: () => ({ userId: "user_admin" }) }));
vi.mock("@workspace/db", () => ({ db: {}, leagueRoundsTable: {}, leaguesTable: {} }));
vi.mock("drizzle-orm", () => ({ asc: () => ({}), eq: () => ({}) }));
const applyTimeAction = vi.fn().mockResolvedValue({ ok: true, message: "moved", days: 7 });
vi.mock("../services/devLeagueTime.js", () => ({ applyTimeAction: (...a: unknown[]) => applyTimeAction(...a), pairNow: vi.fn() }));
vi.mock("../services/leagueRounds.js", () => ({ usesWeeklyRounds: () => true }));
let role: string | null = "owner";
vi.mock("../lib/leagueAccess.js", () => ({ getLeagueRole: async () => role }));

async function app() {
  const { default: router } = await import("../routes/devLeagueTools.js");
  const a = express();
  a.use(express.json());
  a.use("/api", router);
  return a;
}

const env = { ...process.env };
afterEach(() => {
  process.env = { ...env };
  role = "owner";
  applyTimeAction.mockClear();
});

describe("dev league tools", () => {
  it("moves time for a league admin in development", async () => {
    process.env.NODE_ENV = "development";
    const res = await supertest(await app()).post("/api/dev/leagues/3/time").send({ action: "deadline_passed" });
    expect(res.status).toBe(200);
    expect(applyTimeAction).toHaveBeenCalledWith(3, "deadline_passed");
  });

  it("is a 404 in production, before anything runs", async () => {
    process.env.NODE_ENV = "production";
    const res = await supertest(await app()).post("/api/dev/leagues/3/time").send({ action: "deadline_passed" });
    expect(res.status).toBe(404);
    expect(applyTimeAction).not.toHaveBeenCalled();
  });

  it("refuses anyone who isn't an admin of the league", async () => {
    process.env.NODE_ENV = "development";
    role = null;
    const res = await supertest(await app()).post("/api/dev/leagues/3/time").send({ action: "deadline_passed" });
    expect(res.status).toBe(403);
  });

  it("rejects an unknown action", async () => {
    process.env.NODE_ENV = "development";
    const res = await supertest(await app()).post("/api/dev/leagues/3/time").send({ action: "next_year" });
    expect(res.status).toBe(400);
  });
});
