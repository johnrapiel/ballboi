import { describe, expect, it } from "vitest";
import { leagueCardText, myStanding, startDay } from "../leagues";

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
    expect(t.started).toBe(true);
    expect(t.spoken).not.toMatch(/active/i);
  });

  it("not started: start date leads the info line, stats row shows dashes", () => {
    const t = leagueCardText(
      { ...base, name: "Beta Testers", status: "upcoming", startDate: "2026-11-18", playerCount: 3, format: "round_robin" },
      null,
    );
    expect(t.pill).toBe("Singles");
    expect(t.info).toBe("Starts Nov 18 · 3 players · Round robin");
    expect(t.started).toBe(false);
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

// Finding 28: the card finds your row in singles, fixed and rotating doubles.
const row = (playerId: number, rank: number, wins: number, losses: number, teamPlayerIds: number[] | null = null) => ({
  playerId,
  rank,
  wins,
  losses,
  teamPlayerIds,
});

describe("myStanding", () => {
  it("singles: your own row", () => {
    expect(myStanding([row(1, 1, 5, 1), row(7, 2, 3, 3), row(9, 3, 1, 5)], 7)).toEqual({ rank: 2, wins: 3, losses: 3, behind: 2, lead: -2 });
  });

  it("fixed-partner doubles: the team you're on, even when you're the second player", () => {
    const teams = [row(1, 1, 5, 2, [1, 2]), row(3, 2, 4, 3, [3, 7]), row(5, 3, 2, 5, [5, 6])];
    expect(myStanding(teams, 7)).toEqual({ rank: 2, wins: 4, losses: 3, behind: 1, lead: -1 });
    expect(myStanding(teams, 3)).toEqual({ rank: 2, wins: 4, losses: 3, behind: 1, lead: -1 });
  });

  it("fixed-partner doubles: leading team shows how far ahead", () => {
    const teams = [row(1, 1, 5, 2, [1, 7]), row(3, 2, 4, 3, [3, 4])];
    expect(myStanding(teams, 7)).toEqual({ rank: 1, wins: 5, losses: 2, behind: 0, lead: 1 });
  });

  it("rotating doubles: players ranked, your own row", () => {
    expect(myStanding([row(1, 1, 4, 0), row(7, 1, 4, 0), row(9, 3, 0, 4)], 7)).toEqual({ rank: 1, wins: 4, losses: 0, behind: 0, lead: 0 });
  });

  it("no row, no standings, or no player: nothing (the card shows dashes)", () => {
    expect(myStanding([row(1, 1, 5, 1, [1, 2])], 7)).toBeNull();
    expect(myStanding(undefined, 7)).toBeNull();
    expect(myStanding([row(7, 1, 0, 0)], undefined)).toBeNull();
  });
});
