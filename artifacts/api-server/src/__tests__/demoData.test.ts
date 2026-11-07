import { describe, expect, it } from "vitest";
import {
  DEMO_AREAS,
  DEMO_COURTS,
  DEMO_JOIN_REQUEST,
  DEMO_PAST_LEAGUE,
  DEMO_SECOND_LEAGUE,
  hasMatchTiebreak,
  retirementScore,
  simulateMatchWon,
  startForDeadlineDay,
  startForRoundDay,
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
import { roundWindow } from "../lib/leagueCalendar.js";
import { checkTennisScore, flipScore } from "../lib/tennisScore.js";

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

  it("names real demo players in John's other leagues, with no one listed twice", () => {
    const everyone = new Set([...DEMO_LEAGUE_PLAYERS, ...DEMO_NEARBY_PLAYERS].map((p) => `${p.firstName} ${p.lastName}`));
    const second = [...DEMO_SECOND_LEAGUE.members, ...DEMO_SECOND_LEAGUE.waitlist];
    const past = [DEMO_PAST_LEAGUE.organizer, ...DEMO_PAST_LEAGUE.members];
    for (const n of [...second, ...past, DEMO_JOIN_REQUEST]) expect(everyone.has(n), n).toBe(true);
    expect(new Set(second).size).toBe(second.length);
    expect(new Set(past).size).toBe(past.length);
    // Full with John: that's why new requests go to the waitlist.
    expect(DEMO_SECOND_LEAGUE.members.length + 1).toBe(DEMO_SECOND_LEAGUE.rosterCap);
    // Twelve with John, so a top-8 playoff.
    expect(past.length + 1).toBe(12);
  });

  it("has 25 to 40 Discover players with varied levels, hands and towns", () => {
    expect(DEMO_NEARBY_PLAYERS.length).toBeGreaterThanOrEqual(25);
    expect(DEMO_NEARBY_PLAYERS.length).toBeLessThanOrEqual(40);
    const everyone = [...DEMO_LEAGUE_PLAYERS, ...DEMO_NEARBY_PLAYERS];
    const levels = new Set(everyone.map((p) => p.rating));
    for (const l of [2.5, 3, 3.5, 4, 4.5, 5]) expect(levels.has(l), String(l)).toBe(true);
    expect(everyone.some((p) => p.hand === "left")).toBe(true);
    const towns = new Set(everyone.map((p) => DEMO_AREAS[p.zip].town));
    for (const t of ["Beacon", "Poughkeepsie", "Wappingers Falls", "Fishkill", "Newburgh", "Cold Spring"]) expect(towns.has(t), t).toBe(true);
  });

  it("plays at public parks in each nearby town", () => {
    for (const t of ["Beacon", "Poughkeepsie", "Wappingers Falls", "Fishkill", "Newburgh", "Cold Spring"]) {
      expect(DEMO_COURTS.some((c) => c.includes(t)), t).toBe(true);
    }
  });

  it("makes retirements the app accepts, won by the right side", () => {
    const rand = seededRandom(7);
    for (let i = 0; i < 50; i++) {
      const side = i % 2 ? 1 : 2;
      const score = retirementScore(rand, side);
      expect(score.endsWith(" RET")).toBe(true);
      // The app reads a retirement from the winner's side.
      const fromWinner = side === 1 ? score : flipScore(score);
      expect(checkTennisScore(fromWinner, { retired: true }).ok, score).toBe(true);
    }
  });

  it("gives John the result asked for, with a real score", () => {
    const rand = seededRandom(3);
    for (const side of [1, 2, 1, 2] as const) {
      const m = simulateMatchWon(rand, 3.5, 4.5, side);
      expect(m.winnerSide).toBe(side);
      const parsed = parseMatchScore(m.score);
      expect(parsed.ok && parsed.winnerSide).toBe(side);
    }
  });

  it("is mostly straight sets, with some three-setters and match tiebreaks", () => {
    const rand = seededRandom(11);
    const scores = Array.from({ length: 400 }, () => simulateMatch(rand, 3.5, 3.5).score);
    const straight = scores.filter((s) => s.split(", ").length === 2).length;
    expect(straight / scores.length).toBeGreaterThan(0.55);
    expect(scores.some(hasMatchTiebreak)).toBe(true);
    expect(scores.some((s) => /7-6\(\d\)|6-7\(\d\)/.test(s))).toBe(true);
  });

  it("puts today on the last day of a round, or on a given day of it", () => {
    const start = startForDeadlineDay("2026-11-07", 4);
    expect(roundWindow(start, 4).deadline).toBe("2026-11-07");
    const second = startForRoundDay("2026-11-07", 3, 2);
    expect(roundWindow(second, 3).startDate).toBe("2026-11-06");
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
