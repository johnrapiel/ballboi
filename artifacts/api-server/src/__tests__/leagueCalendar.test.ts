import { describe, it, expect } from "vitest";
import { addDays, graceEndFor, hasSeasonStarted, leagueToday, roundWindow } from "../lib/leagueCalendar.js";

// Spec: Leagues. Rounds are weekly from the season's start weekday
// (decision 29), followed by a fixed 1-week grace period (decision 25).

describe("roundWindow", () => {
  it("starts round 1 on the season start and ends it six days later", () => {
    expect(roundWindow("2026-11-05", 1)).toEqual({
      roundNumber: 1,
      startDate: "2026-11-05",
      deadline: "2026-11-11",
      graceEnd: "2026-11-18",
    });
  });

  it("keeps every round on the start weekday (a Thursday season pairs every Thursday)", () => {
    const r3 = roundWindow("2026-11-05", 3);
    expect(r3.startDate).toBe("2026-11-19");
    expect(new Date(`${r3.startDate}T12:00:00Z`).getUTCDay()).toBe(4);
  });

  it("crosses month and year ends", () => {
    expect(roundWindow("2026-12-28", 2).startDate).toBe("2027-01-04");
  });
});

describe("dates", () => {
  it("adds days across a DST change without drifting", () => {
    expect(addDays("2026-10-31", 7)).toBe("2026-11-07");
  });

  it("gives a grace week of 7 days after the deadline", () => {
    expect(graceEndFor("2026-11-11")).toBe("2026-11-18");
  });

  it("uses the East Coast date for today", () => {
    // 02:00 UTC on Nov 6 is still Nov 5 in New York.
    expect(leagueToday(new Date("2026-11-06T02:00:00Z"))).toBe("2026-11-05");
  });

  it("locks joins from the season start day onward", () => {
    expect(hasSeasonStarted("2026-11-05", "2026-11-04")).toBe(false);
    expect(hasSeasonStarted("2026-11-05", "2026-11-05")).toBe(true);
    expect(hasSeasonStarted(null, "2026-11-05")).toBe(false);
  });
});
