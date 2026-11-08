import { describe, it, expect, vi } from "vitest";
import type { Row } from "./fakeDb";

// Row 1 follow-on: an older league's rounds (no admin review) go out to
// players as they're made, by the admin's Generate or the legacy scheduler
// job, so they're stored as published. Otherwise the draft rule would hide
// them from the players they were just announced to.

vi.mock("../lib/logger", () => ({ logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() } }));
const rows: Record<string, Row[]> = {};
vi.mock("@workspace/db", async () => {
  const { fakeDb, table } = await import("./fakeDb");
  return {
    db: fakeDb(rows),
    leaguesTable: table("leagues", ["id"]),
    playersTable: table("players", ["id", "leagueId"]),
    matchesTable: table("matches", ["id", "leagueId", "roundId"]),
    leagueRoundsTable: table("league_rounds", ["id", "leagueId", "roundNumber"]),
  };
});
vi.mock("drizzle-orm", async () => (await import("./fakeDb")).drizzleFake);
vi.mock("../services/seasonService", () => ({ getAutoSeason: vi.fn().mockResolvedValue(null) }));

describe("legacy round generation", () => {
  it("stores every new round as published", async () => {
    Object.assign(rows, {
      leagues: [{ id: 1, name: "Old league", seasonWeeks: null, matchDay: null, matchTime: null, timeZone: null }],
      players: [1, 2, 3, 4].map((id) => ({ id, leagueId: 1, name: `P${id}` })),
      league_rounds: [],
      matches: [],
    });
    const { generateAllRounds } = await import("../services/roundPairing.js");
    const made = await generateAllRounds(1, 6);
    expect(made).toHaveLength(6);
    expect(rows.league_rounds).toHaveLength(6);
    for (const r of rows.league_rounds) expect(r.publishedAt).toBeInstanceOf(Date);
  });
});
