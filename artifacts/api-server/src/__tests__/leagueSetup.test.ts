import { describe, it, expect } from "vitest";

import { seasonDates, validateLeagueSetup, type LeagueSetupInput } from "../lib/leagueSetup.js";

const base: LeagueSetupInput = {
  format: "flex",
  leagueType: "singles",
  visibility: "private",
  startDate: "2026-11-02",
  seasonWeeks: 8,
  playing: true,
  playerName: "John Rapiel",
};

describe("validateLeagueSetup", () => {
  it("accepts a default Flex singles league", () => {
    expect(validateLeagueSetup(base)).toBeNull();
  });

  it("accepts Round robin", () => {
    expect(validateLeagueSetup({ ...base, format: "round_robin" })).toBeNull();
  });

  it("rejects formats the spec doesn't launch with", () => {
    expect(validateLeagueSetup({ ...base, format: "swiss" })).toMatch(/Flex or Round robin/);
    expect(validateLeagueSetup({ ...base, format: "ladder" })).toMatch(/Flex or Round robin/);
  });

  it("keeps seasons between 6 and 12 weeks", () => {
    expect(validateLeagueSetup({ ...base, seasonWeeks: 5 })).toMatch(/6 to 12/);
    expect(validateLeagueSetup({ ...base, seasonWeeks: 13 })).toMatch(/6 to 12/);
    expect(validateLeagueSetup({ ...base, seasonWeeks: 6 })).toBeNull();
    expect(validateLeagueSetup({ ...base, seasonWeeks: 12 })).toBeNull();
  });

  it("needs a real start date", () => {
    expect(validateLeagueSetup({ ...base, startDate: "next week" })).toMatch(/Start date/);
    expect(validateLeagueSetup({ ...base, startDate: "2026-13-40" })).toMatch(/Start date/);
  });

  it("needs a partner mode for doubles, and none for singles", () => {
    expect(validateLeagueSetup({ ...base, leagueType: "doubles" })).toMatch(/fixed or rotating/);
    expect(validateLeagueSetup({ ...base, leagueType: "doubles", partnerMode: "rotating" })).toBeNull();
    expect(validateLeagueSetup({ ...base, partnerMode: "fixed" })).toMatch(/Only doubles/);
  });

  it("only lets Open leagues set a rating range, and keeps it in order", () => {
    expect(validateLeagueSetup({ ...base, minRating: "3.0" })).toMatch(/Only Open/);
    expect(validateLeagueSetup({ ...base, visibility: "open", minRating: "3.0", maxRating: "4.0" })).toBeNull();
    expect(validateLeagueSetup({ ...base, visibility: "open", minRating: "4.0", maxRating: "3.0" })).toMatch(/lowest/);
    expect(validateLeagueSetup({ ...base, visibility: "open", minRating: "6.0" })).toMatch(/2.5 and 5.0/);
  });

  it("needs the admin's name only when they're playing", () => {
    expect(validateLeagueSetup({ ...base, playerName: " " })).toMatch(/name/);
    expect(validateLeagueSetup({ ...base, playing: false, playerName: null })).toBeNull();
  });
});

describe("seasonDates", () => {
  const today = new Date("2026-10-21T12:00:00Z");

  it("ends on the last day of the final week", () => {
    expect(seasonDates("2026-11-02", 8, today).endDate).toBe("2026-12-27");
    expect(seasonDates("2026-11-02", 6, today).endDate).toBe("2026-12-13");
  });

  it("is upcoming when it starts after today, active otherwise", () => {
    expect(seasonDates("2026-11-02", 8, today).status).toBe("upcoming");
    expect(seasonDates("2026-10-21", 8, today).status).toBe("active");
    expect(seasonDates("2026-10-01", 8, today).status).toBe("active");
  });
});
