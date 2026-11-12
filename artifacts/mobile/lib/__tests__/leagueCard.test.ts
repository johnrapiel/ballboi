import { describe, expect, it } from "vitest";
import { leagueCardText, startDay } from "../leagues";

// Leagues tab card (finding 27, decision 183).

const base = {
  name: "Test League 1",
  status: "active" as const,
  leagueType: "singles",
  partnerMode: null,
  startDate: "2026-11-02",
  playerCount: 13,
  format: "flex" as const,
};

describe("leagueCardText", () => {
  it("running singles: Singles pill, no status, stats row", () => {
    const t = leagueCardText(base, "Memorial Park, Beacon");
    expect(t.pill).toBe("Singles");
    expect(t.starts).toBeNull();
    expect(t.info).toBe("Memorial Park, Beacon · 13 players · Flex");
    expect(t.showStats).toBe(true);
    expect(t.spoken).not.toMatch(/active/i);
  });

  it("not started: start date leads the info line, no stats row", () => {
    const t = leagueCardText(
      { ...base, name: "Beta Testers", status: "upcoming", startDate: "2026-11-18", playerCount: 3, format: "round_robin" },
      null,
    );
    expect(t.pill).toBe("Singles");
    expect(t.info).toBe("Starts Nov 18 · 3 players · Round robin");
    expect(t.showStats).toBe(false);
    expect(t.spoken).toBe("Beta Testers, Singles, starts November 18, 3 players, round robin");
  });

  it("doubles: Doubles pill, partner type in the info line", () => {
    expect(leagueCardText({ ...base, leagueType: "doubles", partnerMode: "fixed" }, null).info).toBe("13 players · Fixed partners · Flex");
    const r = leagueCardText({ ...base, leagueType: "doubles", partnerMode: "rotating" }, null);
    expect(r.pill).toBe("Doubles");
    expect(r.info).toContain("Rotating partners");
  });

  it("no type reads as Singles", () => {
    expect(leagueCardText({ ...base, leagueType: null }, null).pill).toBe("Singles");
  });
});

describe("startDay", () => {
  it("reads a date the same in every time zone", () => {
    expect(startDay("2026-11-18")).toBe("Nov 18");
    expect(startDay("2026-11-18T00:00:00.000Z")).toBe("Nov 18");
    expect(startDay(null)).toBeNull();
    expect(startDay("soon")).toBeNull();
  });
});
