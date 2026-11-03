import { describe, expect, it } from "vitest";
import {
  DEMO_AREAS,
  DEMO_LEAGUE_PLAYERS,
  DEMO_NEARBY_PLAYERS,
  DEMO_OPEN_LEAGUES,
  demoEmail,
  nyTime,
  seededRandom,
  simulateMatch,
  startForRound,
} from "../lib/demoData.js";
import { parseMatchScore } from "../lib/leagueScoring.js";

describe("demo data", () => {
  it("has 12 league players and unique emails with a known area", () => {
    expect(DEMO_LEAGUE_PLAYERS).toHaveLength(12);
    const everyone = [...DEMO_LEAGUE_PLAYERS, ...DEMO_NEARBY_PLAYERS];
    expect(new Set(everyone.map(demoEmail)).size).toBe(everyone.length);
    for (const p of everyone) expect(DEMO_AREAS[p.zip], p.zip).toBeDefined();
    expect(demoEmail({ firstName: "Ryan", lastName: "O'Connor" })).toBe("ballboi-demo-ryan-oconnor+clerk_test@example.com");
  });

  it("Open leagues name real nearby players", () => {
    const names = new Set(DEMO_NEARBY_PLAYERS.map((p) => `${p.firstName} ${p.lastName}`));
    for (const o of DEMO_OPEN_LEAGUES) for (const n of [o.organizer, ...o.members]) expect(names.has(n), n).toBe(true);
  });

  it("makes scores the app accepts, with the right winner", () => {
    const rand = seededRandom(1);
    for (let i = 0; i < 500; i++) {
      const { score, winnerSide } = simulateMatch(rand, 2.5 + rand() * 2.5, 2.5 + rand() * 2.5);
      const parsed = parseMatchScore(score);
      expect(parsed.ok, score).toBe(true);
      if (parsed.ok) expect(parsed.winnerSide).toBe(winnerSide);
    }
  });

  it("repeats the same scores for the same seed", () => {
    const a = seededRandom(42);
    const b = seededRandom(42);
    expect(simulateMatch(a, 3.5, 4)).toEqual(simulateMatch(b, 3.5, 4));
  });

  it("moves a season back so today is in the given round, keeping its weekday", () => {
    // A Thursday start; today is Monday Nov 2, 2026.
    const start = startForRound("2026-11-12", "2026-11-02", 4);
    expect(start).toBe("2026-10-08");
    expect(new Date(`${start}T00:00:00Z`).getUTCDay()).toBe(4);
    // Today is the start weekday: round 4 begins today.
    expect(startForRound("2026-11-09", "2026-11-02", 4)).toBe("2026-10-12");
  });

  it("converts New York local times across daylight saving", () => {
    expect(nyTime("2026-11-02", 18)).toBe("2026-11-02T23:00:00.000Z");
    expect(nyTime("2026-10-15", 18, 30)).toBe("2026-10-15T22:30:00.000Z");
  });
});
