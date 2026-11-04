import { describe, it, expect } from "vitest";
import {
  addDays,
  dayBounds,
  graceEndFor,
  hasSeasonStarted,
  isTimeZone,
  leagueToday,
  leagueZone,
  localHour,
  roundMatchTime,
  roundPhase,
  roundWindow,
  todayFor,
  zonedTime,
} from "../lib/leagueCalendar.js";

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

describe("roundPhase", () => {
  const out = { publishedAt: new Date(), startDate: "2026-11-05", endDate: "2026-11-11" };
  it("follows a round through its week and grace week", () => {
    expect(roundPhase({ ...out, publishedAt: null }, "2026-11-05")).toBe("draft");
    expect(roundPhase(out, "2026-11-04")).toBe("upcoming");
    expect(roundPhase(out, "2026-11-11")).toBe("open");
    expect(roundPhase(out, "2026-11-12")).toBe("grace");
    expect(roundPhase(out, "2026-11-19")).toBe("closed");
  });
});

// PR 4: a league runs on its creator's time zone.
describe("a league in Los Angeles", () => {
  const la = { timeZone: "America/Los_Angeles" };

  it("starts its day at midnight Los Angeles time, not Eastern", () => {
    // 05:00 UTC on Nov 6 is Nov 6 in New York but still Nov 5 in Los Angeles.
    const at = new Date("2026-11-06T05:00:00Z");
    expect(todayFor({ timeZone: "America/New_York" }, at)).toBe("2026-11-06");
    expect(todayFor(la, at)).toBe("2026-11-05");
  });

  it("pairs at 7am on its own clock", () => {
    // 7am in Los Angeles is 10am in New York.
    expect(localHour(new Date("2026-11-05T15:00:00Z"), "America/Los_Angeles")).toBe(7);
    expect(localHour(new Date("2026-11-05T15:00:00Z"), "America/New_York")).toBe(10);
  });

  it("closes a round's deadline at the end of the day there", () => {
    const round = { publishedAt: new Date(), startDate: "2026-11-05", endDate: "2026-11-11" };
    // 11:30 PM Wed Nov 11 in Los Angeles is already Thu Nov 12 in New York.
    const late = new Date("2026-11-12T07:30:00Z");
    expect(roundPhase(round, todayFor(la, late))).toBe("open");
    expect(roundPhase(round, todayFor({ timeZone: "America/New_York" }, late))).toBe("grace");
  });

  it("turns a local date and time into the right instant, across daylight saving", () => {
    expect(zonedTime("2026-11-10", "18:30", "America/Los_Angeles").toISOString()).toBe("2026-11-11T02:30:00.000Z");
    expect(zonedTime("2026-07-14", "18:30", "America/Los_Angeles").toISOString()).toBe("2026-07-15T01:30:00.000Z");
    expect(dayBounds("2026-11-05", "America/Los_Angeles")).toEqual({
      from: new Date("2026-11-05T08:00:00Z"),
      to: new Date("2026-11-06T08:00:00Z"),
    });
    // The day daylight saving ends is 25 hours long.
    const fallBack = dayBounds("2026-11-01", "America/Los_Angeles");
    expect(fallBack.to.getTime() - fallBack.from.getTime()).toBe(25 * 60 * 60 * 1000);
  });

  it("finds the round's match day for a weekly match time", () => {
    const week = { startDate: "2026-11-05", endDate: "2026-11-11" }; // Thursday to Wednesday
    expect(roundMatchTime({ ...la, matchDay: 2, matchTime: "18:30" }, week)).toBe("2026-11-11T02:30:00.000Z"); // Tue Nov 10
    expect(roundMatchTime({ ...la, matchDay: 4, matchTime: "09:00" }, week)).toBe("2026-11-05T17:00:00.000Z"); // Thu Nov 5
    expect(roundMatchTime({ ...la, matchDay: null, matchTime: null }, week)).toBeNull();
    expect(roundMatchTime({ ...la, matchDay: 2, matchTime: "6pm" }, week)).toBeNull();
  });

  it("falls back to Eastern for leagues without a usable time zone", () => {
    expect(leagueZone({ timeZone: null })).toBe("America/New_York");
    expect(leagueZone({ timeZone: "Mars/Olympus" })).toBe("America/New_York");
    expect(isTimeZone("America/Los_Angeles")).toBe(true);
  });
});
